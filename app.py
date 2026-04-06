import os
import io
import re
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from PyPDF2 import PdfReader
from dotenv import load_dotenv
import json
import hashlib
import uuid
import time
import smtplib
from email.message import EmailMessage
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests

# Ensure API Key is loaded
load_dotenv()
try:
    from google import genai
    from google.genai import types
except ImportError:
    genai = None

app = Flask(__name__)
# Crucial: Disable static caching so the browser fetches fresh HTML/JS instead of using the 12-hour cache.
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0

# Enable CORS for frontend connectivity
CORS(app)

def analyze_resume_gemini(text):
    """Authentic AI Parser utilizing Google Gemini SDK to execute the strict ATS screening."""
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key or "your_api_key_here" in api_key:
         return {
            "score": 0,
            "extractedData": { "name": "Configuration Error", "role": "Backend Missing API Key", "emails": [] },
            "detailedFeedback": [{"section": "System API Key Required", "before": "Gemini cannot read this.", "after": "You must paste your API key into the .env file!"}],
            "suggestions": [
                "CRITICAL ERROR: No Gemini API Key was detected in your backend environment.",
                "To process real applicant context, you must acquire a free token from Google AI Studio.",
                "Paste it into the new `.env` file I created in your project folder and restart the app."
            ]
        }
    
    if not genai:
        return {"error": "Missing google-genai. Please ensure pip install google-genai passed."}

    client = genai.Client()
    
    system_prompt = """
    You are an enterprise Applicant Tracking System (ATS) parsing algorithm.
    You will receive raw, unformatted, ugly text extracted from an applicant's resume.
    You MUST output EXCLUSIVELY raw JSON matching the exact schema provided. DO NOT WRAP IN ```json
    
    SCHEMA Requirements:
    {
        "score": <integer from 0 to 100 representing overall quality/format/impact. NOTE: Typical professional resumes should score between 75 and 95. Be realistic and encouraging, only scoring below 70 for genuinely empty or exceptionally bad resumes.>,
        "extractedData": {
            "name": "<Candidate Full Name>",
            "role": "<Detected Job Title or Target Industry>",
            "emails": ["<email1>"],
            "skills": ["<skill1>", "<skill2>"],
            "projects": ["<proj1>", "<proj2>"],
            "certifications": ["<cert1>"],
            "cgpa": "<gpa or null>"
        },
        "detailedFeedback": [
            {
               "section": "<e.g., Professional Summary>",
               "before": "<must be an EXACT sentence extracted directly from the candidate's text>",
               "after": "<a highly optimized, action-driven, metric-focused rewrite of that same specific sentence>"
            },
            ... Provide exactly 3 or 4 detailed feedback objects, pulling REAL text ...
        ],
        "suggestions": [
             "<A specific string suggesting an overall formatting fix using ATS terminology>",
             "<Another high-level professional suggestion>"
        ]
    }
    """
    
    try:
        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=text,
            config=types.GenerateContentConfig(
                system_instruction=system_prompt,
                temperature=0.2,
                response_mime_type="application/json"
            ),
        )
        # Parse the JSON explicitly
        result = json.loads(response.text)
        # Pass the raw text back along with the parse structure
        result["rawTextSnippet"] = text
        return result
    except Exception as e:
        print(f"Gemini AI Parsing Failed: {e}")
        return {
             "score": 0,
             "extractedData": { "name": "AI Processing Failure", "role": "Gemini Model Issue", "emails": [] },
             "detailedFeedback": [{"section": "Error", "before": "Failed Prompt", "after": f"API Error: {str(e)}"}],
             "suggestions": ["The backend attempted to contact Gemini but failed. Verify internet connection and quota."]
        }


@app.route('/')
def serve_index():
    return send_from_directory('.', 'index.html')

@app.route('/<path:path>')
def send_static(path):
    # Security Rule: Block any public access to the uploads folder
    if path.startswith('uploads/') or path.startswith('uploads\\'):
        return jsonify({"error": "Admin Access Required. Directory is locked."}), 403
    return send_from_directory('.', path)

@app.route('/api/upload', methods=['POST'])
def analyze_resume():
    print('\n--- 🚀 New Offline Heuristic Request Received ---')
    
    if 'resume' not in request.files or request.files['resume'].filename == '':
        return jsonify({"error": "No file uploaded"}), 400
        
    file = request.files['resume']
    # Extract email from the frontend form (or use anonymous if not found)
    email_val = request.form.get('email', 'anonymous').replace('/', '_').replace('\\', '_')
    print(f'File Uploaded: {file.filename} by {email_val}')
    
    file_bytes = file.read()
    
    # --- Backend Memory: Admin Archive ---
    # Guarantee absolute path: E:\Downloads\resume website\uploads
    base_dir = os.path.dirname(os.path.abspath(__file__))
    upload_dir = os.path.join(base_dir, 'uploads')
    if not os.path.exists(upload_dir):
        os.makedirs(upload_dir)
        
    safe_filename = file.filename.replace('/', '_').replace('\\', '_')
    file_path = os.path.join(upload_dir, f"[{email_val}]_{safe_filename}")
    try:
        with open(file_path, "wb") as f:
            f.write(file_bytes)
        print(f"Archived document to: {file_path}")
    except Exception as e:
        print("Failed to archive PDF:", e)
    
    extracted_text = ""
    try:
        filename_lower = file.filename.lower()
        if filename_lower.endswith('.pdf'):
            pdf_bytes_io = io.BytesIO(file_bytes)
            reader = PdfReader(pdf_bytes_io)
            for page in reader.pages:
                extracted_text += page.extract_text() + "\n"
        elif filename_lower.endswith(('.jpg', '.jpeg', '.png')):
            print("User tried to upload an image!")
            return jsonify({
                "score": 0,
                "extractedData": { "name": "Format Error", "role": "Incorrect File Type", "emails": [] },
                "detailedFeedback": [{"section": "Error", "before": "Upload format", "after": "Please upload a true PDF document, not an image."}],
                "suggestions": [
                    "CRITICAL ERROR: You uploaded a picture (.jpg/.png) of a resume!",
                    "The system cannot read pictures as raw text. You MUST upload a true .pdf document."
                ]
            })
        elif filename_lower.endswith('.docx'):
            print("Parsing Microsoft Word Document (.docx)...")
            try:
                import docx
            except ImportError:
                return jsonify({"error": "The python-docx library is not installed. Please run: pip install python-docx"}), 500
                
            doc_file = io.BytesIO(file_bytes)
            doc = docx.Document(doc_file)
            for para in doc.paragraphs:
                extracted_text += para.text + "\n"
                
        elif filename_lower.endswith('.doc'):
            print("User tried to upload a Legacy Word Document (.doc)!")
            return jsonify({
                "score": 0,
                "extractedData": { "name": "Format Error", "role": "Legacy Word Document", "emails": [] },
                "detailedFeedback": [{"section": "Error", "before": "Uploaded 1997 Word Doc", "after": "Save as .docx or PDF."}],
                "suggestions": [
                    "CRITICAL ERROR: You uploaded a legacy 1997 Microsoft Word document (.doc).",
                    "This system supports modern Word formats (.docx) and PDFs.",
                    "Please click File -> 'Save As' -> Word Document (.docx) and upload again!"
                ]
            })
        else:
            extracted_text = file_bytes.decode('utf-8', errors='ignore')
    except Exception as e:
        print("PDF Parsing Error:", e)
        return jsonify({
            "score": 0,
            "suggestions": [f"File read error: {str(e)}", "Please upload a valid text-based PDF document."]
        })

    # --- Fingerprint / Caching Logic (Deterministic Scoring) ---
    text_hash = hashlib.sha256(extracted_text.encode('utf-8')).hexdigest()
    cache_path = os.path.join(upload_dir, f"cache_{text_hash}.json")
    
    if os.path.exists(cache_path):
        print("🔍 Exact resume match found in cache! Returning deterministic score.")
        try:
            with open(cache_path, "r") as cf:
                ai_response_dict = json.load(cf)
        except Exception as e:
            print("Failed to load cache:", e)
            print("Fallback: Running AUTHENTIC Gemini API screening...")
            ai_response_dict = analyze_resume_gemini(extracted_text)
    else:
        print("Text extracted successfully! Running AUTHENTIC Gemini API screening...")
        ai_response_dict = analyze_resume_gemini(extracted_text)
        
        # Save to cache for deterministic future requests
        try:
            with open(cache_path, "w") as cf:
                json.dump(ai_response_dict, cf, indent=4)
        except Exception as e:
            print("Failed to save cache:", e)
    
    # --- Backend Memory: Admin Archive JSON ---
    try:
        json_path = os.path.join(upload_dir, f"[{email_val}]_analysis.json")
        with open(json_path, "w") as jf:
            json.dump(ai_response_dict, jf, indent=4)
        print(f"Archived JSON analysis to: {json_path}")
    except Exception as e:
        print("Failed to archive JSON:", e)
        
    print(f'✅ Offline Analysis Complete! Final Document Score: {ai_response_dict.get("score")}/100')
    
    # Check if a real email was provided and send the detailed report!
    email_raw = request.form.get('email', '')
    if '@' in email_raw:
        clean_email = email_raw.strip()
        send_detailed_analysis_email(clean_email, ai_response_dict)
        
    return jsonify(ai_response_dict)

@app.route('/api/rescan', methods=['POST'])
def rescan_resume():
    data = request.get_json()
    if not data or 'text' not in data:
        return jsonify({"error": "No text provided"}), 400
        
    extracted_text = data['text']
    email_val = data.get('email', 'anonymous').replace('/', '_').replace('\\', '_')
    
    print('\n--- ⚡ Live Editor Rescan Request Received ---')
    
    base_dir = os.path.dirname(os.path.abspath(__file__))
    upload_dir = os.path.join(base_dir, 'uploads')
    if not os.path.exists(upload_dir):
        os.makedirs(upload_dir)
        
    text_hash = hashlib.sha256(extracted_text.encode('utf-8')).hexdigest()
    cache_path = os.path.join(upload_dir, f"cache_{text_hash}.json")
    
    if os.path.exists(cache_path):
        print("🔍 Exact resume match found in cache! Returning deterministic score.")
        try:
            with open(cache_path, "r") as cf:
                ai_response_dict = json.load(cf)
        except Exception as e:
            print("Failed to load cache:", e)
            print("Fallback: Running AUTHENTIC Gemini API screening...")
            ai_response_dict = analyze_resume_gemini(extracted_text)
    else:
        print("Text difference detected! Running AUTHENTIC Gemini API rescan...")
        ai_response_dict = analyze_resume_gemini(extracted_text)
        
        try:
            with open(cache_path, "w") as cf:
                json.dump(ai_response_dict, cf, indent=4)
        except Exception as e:
            print("Failed to save cache:", e)
            
    # Save the updated JSON archive
    try:
        json_path = os.path.join(upload_dir, f"[{email_val}]_analysis_rescan.json")
        with open(json_path, "w") as jf:
            json.dump(ai_response_dict, jf, indent=4)
    except Exception as e:
        print("Failed to archive rescan JSON:", e)
        
    return jsonify(ai_response_dict)

@app.route('/api/delete_cache', methods=['POST'])
def delete_cache():
    data = request.get_json()
    if not data or 'hash' not in data or 'password' not in data:
        return jsonify({"error": "Missing hash or password"}), 400
        
    file_hash = data['hash']
    password = str(data['password'])
    
    # Simple password check
    if password != "2004":
        return jsonify({"error": "Unauthorized. Incorrect password."}), 403
        
    # Prevent directory traversal attacks
    if not re.match(r'^[a-f0-9]+$', file_hash):
        return jsonify({"error": "Invalid format"}), 400
        
    base_dir = os.path.dirname(os.path.abspath(__file__))
    upload_dir = os.path.join(base_dir, 'uploads')
    cache_path = os.path.join(upload_dir, f"cache_{file_hash}.json")
    
    if os.path.exists(cache_path):
        try:
            os.remove(cache_path)
            print(f"🗑️ Securely deleted cache file: cache_{file_hash}.json")
            return jsonify({"success": "Cache file deleted successfully."}), 200
        except Exception as e:
            return jsonify({"error": f"Failed to delete file: {str(e)}"}), 500
    else:
        return jsonify({"error": "Cache file not found."}), 404

# --- DYNAMIC REVIEWS & ADMIN SYSTEM ---
REVIEWS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads', 'reviews.json')

def load_reviews():
    if os.path.exists(REVIEWS_FILE):
        try:
            with open(REVIEWS_FILE, 'r') as f:
                return json.load(f)
        except:
            return []
    return []

def save_reviews(reviews):
    base_dir = os.path.dirname(os.path.abspath(__file__))
    upload_dir = os.path.join(base_dir, 'uploads')
    if not os.path.exists(upload_dir):
        os.makedirs(upload_dir)
    with open(REVIEWS_FILE, 'w') as f:
        json.dump(reviews, f, indent=4)

@app.route('/api/reviews', methods=['GET'])
def get_public_reviews():
    reviews = load_reviews()
    # Only return approved reviews
    approved = [r for r in reviews if r.get('approved', False)]
    return jsonify(approved), 200

@app.route('/api/reviews', methods=['POST'])
def submit_review():
    data = request.get_json()
    if not data or 'name' not in data or 'quote' not in data:
        return jsonify({"error": "Missing fields"}), 400
        
    reviews = load_reviews()
    new_review = {
        "id": str(uuid.uuid4()),
        "name": data.get("name", "Anonymous"),
        "role": data.get("role", "User"),
        "rating": min(max(int(data.get("rating", 5)), 1), 5),
        "quote": data.get("quote", ""),
        "approved": False,
        "timestamp": time.time()
    }
    reviews.append(new_review)
    save_reviews(reviews)
    return jsonify({"success": "Review submitted. Pending admin approval."}), 201

@app.route('/api/admin/reviews/pending', methods=['POST'])
def get_pending_reviews():
    data = request.get_json()
    if not data or data.get('password') != '2004':
        return jsonify({"error": "Unauthorized"}), 403
        
    reviews = load_reviews()
    pending = [r for r in reviews if not r.get('approved', False)]
    return jsonify(pending), 200

@app.route('/api/admin/reviews/approve', methods=['POST'])
def approve_review():
    data = request.get_json()
    if not data or data.get('password') != '2004' or 'id' not in data:
        return jsonify({"error": "Unauthorized or missing ID"}), 403
        
    reviews = load_reviews()
    for r in reviews:
        if r['id'] == data['id']:
            r['approved'] = True
            save_reviews(reviews)
            return jsonify({"success": "Review approved"}), 200
    return jsonify({"error": "Review not found"}), 404

@app.route('/api/admin/reviews/reject', methods=['POST'])
def reject_review():
    data = request.get_json()
    if not data or data.get('password') != '2004' or 'id' not in data:
        return jsonify({"error": "Unauthorized or missing ID"}), 403
        
    reviews = load_reviews()
    updated_reviews = [r for r in reviews if r['id'] != data['id']]
    save_reviews(updated_reviews)
    return jsonify({"success": "Review rejected/deleted"}), 200

@app.route('/api/admin/reviews/like', methods=['POST'])
def like_review():
    data = request.get_json()
    if not data or data.get('password') != '2004' or 'id' not in data:
        return jsonify({"error": "Unauthorized or missing ID"}), 403
        
    reviews = load_reviews()
    for r in reviews:
        if r['id'] == data['id']:
            r['admin_liked'] = not r.get('admin_liked', False)
            save_reviews(reviews)
            return jsonify({"success": "Review like toggled"}), 200
    return jsonify({"error": "Review not found"}), 404

@app.route('/api/admin/questions/like', methods=['POST'])
def like_question():
    data = request.get_json()
    if not data or data.get('password') != '2004' or 'id' not in data:
        return jsonify({"error": "Unauthorized or missing ID"}), 403
        
    questions = load_questions()
    for q in questions:
        if q['id'] == data['id']:
            q['admin_liked'] = not q.get('admin_liked', False)
            save_questions(questions)
            return jsonify({"success": "Question like toggled"}), 200
    return jsonify({"error": "Question not found"}), 404

@app.route('/api/admin/questions/delete', methods=['POST'])
def delete_question():
    data = request.get_json()
    if not data or data.get('password') != '2004' or 'id' not in data:
        return jsonify({"error": "Unauthorized or missing ID"}), 403
        
    questions = load_questions()
    updated_questions = [q for q in questions if q['id'] != data['id']]
    save_questions(updated_questions)
    return jsonify({"success": "Question deleted"}), 200

# --- GOOGLE AUTH & WELCOME EMAIL ---
GOOGLE_CLIENT_ID = "958346886655-k57amnd1gv8bskjl87gs1urakvqip3ld.apps.googleusercontent.com" # User injected this!

def send_welcome_email(user_email, user_name):
    # This requires SMTP_EMAIL and SMTP_PWD in .env
    smtp_email = os.environ.get("SMTP_EMAIL")
    smtp_pwd = os.environ.get("SMTP_PWD")
    
    if not smtp_email or not smtp_pwd:
        print("❌ Could not send welcome email: SMTP credentials missing in .env")
        return False
        
    try:
        msg = EmailMessage()
        msg['Subject'] = 'Welcome to Smart Resume Analyzer! 🚀'
        msg['From'] = smtp_email
        msg['To'] = user_email
        
        msg.set_content(f"""
        Hi {user_name},
        
        Welcome to Smart Resume Analyzer! We are incredibly excited to help you optimize your resume for top-tier ATS systems.
        
        Log in anytime to track your scans and improve your score.
        
        Best,
        The Smart Resume AI Team
        """)
        
        with smtplib.SMTP_SSL('smtp.gmail.com', 465) as smtp:
            smtp.login(smtp_email, smtp_pwd)
            smtp.send_message(msg)
            
        print(f"📧 Successfully sent welcome email to {user_email}")
        return True
    except Exception as e:
        print(f"❌ Failed to send welcome email to {user_email}: {str(e)}")
        return False

def send_detailed_analysis_email(user_email, ai_response_dict):
    smtp_email = os.environ.get("SMTP_EMAIL")
    smtp_pwd = os.environ.get("SMTP_PWD")
    
    if not smtp_email or not smtp_pwd:
        return False
        
    try:
        score = ai_response_dict.get('score', 0)
        extracted = ai_response_dict.get('extractedData', {})
        name = extracted.get('name', 'Job Seeker')
        role = extracted.get('role', 'General Applicant')
        skills = extracted.get('skills', [])
        projects = extracted.get('projects', [])
        suggestions = ai_response_dict.get('suggestions', [])
        feedback = ai_response_dict.get('detailedFeedback', [])
        
        color = "#ef4444" 
        score_text = "Needs Improvement"
        if score >= 80: 
            color = "#22c55e"
            score_text = "Excellent"
        elif score >= 60: 
            color = "#eab308"
            score_text = "Good - Almost There"
        
        skills_html = ", ".join([f"<span style='background-color: #1e293b; padding: 4px 8px; border-radius: 4px; font-size: 13px; margin: 2px; display: inline-block; border: 1px solid #334155;'>{s}</span>" for s in skills]) if skills else "None detected"
        projects_html = "".join([f"<li style='margin-bottom: 5px;'>{p}</li>" for p in projects]) if projects else "<li>None detected</li>"

        html_content = f"""
        <html>
        <body style="background-color: #030712; color: #f8fafc; font-family: 'Inter', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 20px; line-height: 1.6; margin: 0;">
            <div style="max-width: 650px; margin: 0 auto; background: linear-gradient(145deg, #0f1423 0%, #0a0e17 100%); border-radius: 16px; border: 1px solid #1e293b; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
                
                <!-- HEADER -->
                <div style="background: linear-gradient(90deg, #8b5cf6 0%, #06b6d4 100%); padding: 30px 20px; text-align: center;">
                    <h2 style="color: #ffffff; margin: 0; font-size: 28px; letter-spacing: 1px; text-shadow: 0 2px 4px rgba(0,0,0,0.3);">Smart Resume Analyzer</h2>
                    <p style="color: #e2e8f0; margin: 10px 0 0 0; font-size: 16px;">Comprehensive AI ATS Screening Report</p>
                </div>

                <div style="padding: 40px 30px;">
                    <h1 style="text-align: center; font-size: 24px; margin-top: 0; color: #f1f5f9;">Hi {name}, your analysis is ready!</h1>
                    <p style="text-align: center; color: #94a3b8; font-size: 16px;">Target Role: <strong style="color: #38bdf8;">{role}</strong></p>
                    
                    <!-- SCORE SECTION -->
                    <div style="text-align: center; margin: 40px 0; background: rgba(15, 23, 42, 0.4); border-radius: 12px; padding: 30px; border: 1px solid rgba(255,255,255,0.05);">
                        <div style="display: inline-block; padding: 35px; border-radius: 50%; border: 6px solid {color}; box-shadow: 0 0 20px rgba(0,0,0,0.4), inset 0 0 15px rgba(0,0,0,0.4); background-color: #0b0f19;">
                            <div style="font-size: 64px; font-weight: 800; color: {color}; line-height: 1;">{score}</div>
                            <div style="font-size: 18px; color: #94a3b8; margin-top: 5px;">/ 100</div>
                        </div>
                        <h3 style="color: {color}; margin-top: 20px; font-size: 22px;">{score_text}</h3>
                        <p style="color: #cbd5e1; font-size: 15px; max-width: 80%; margin: 10px auto 0 auto;">
                            Your resume has been structurally parsed and intelligently graded. The score reflects content impact, keyword optimization, and ATS parsing reliability. A score above 80 indicates strong alignment with professional standards.
                        </p>
                    </div>
                    
                    <!-- DATA EXTRACTED TABLE -->
                    <h3 style="color: #38bdf8; border-bottom: 2px solid rgba(56, 189, 248, 0.2); padding-bottom: 10px; margin-top: 40px; font-size: 20px;">🕵️ AI Data Extraction Summary</h3>
                    <p style="color: #94a3b8; font-size: 14px; margin-bottom: 15px;">This is exactly what an ATS sees when it reads your document. If anything is missing, your format is preventing it from being read.</p>
                    <table style="width: 100%; border-collapse: collapse; margin-bottom: 30px; border-radius: 8px; overflow: hidden;">
                        <tr style="background-color: rgba(30, 41, 59, 0.8);">
                            <td style="padding: 15px; border-bottom: 1px solid #334155; width: 30%; color: #94a3b8; font-weight: bold;">Identified Skills</td>
                            <td style="padding: 15px; border-bottom: 1px solid #334155; width: 70%;">{skills_html}</td>
                        </tr>
                        <tr style="background-color: rgba(15, 23, 42, 0.6);">
                            <td style="padding: 15px; color: #94a3b8; font-weight: bold; vertical-align: top;">Key Projects</td>
                            <td style="padding: 15px;">
                                <ul style="margin: 0; padding-left: 20px; color: #cbd5e1; font-size: 14px;">
                                    {projects_html}
                                </ul>
                            </td>
                        </tr>
                    </table>

                    <!-- TOP SUGGESTIONS -->
                    <h3 style="color: #8b5cf6; border-bottom: 2px solid rgba(139, 92, 246, 0.2); padding-bottom: 10px; margin-top: 40px; font-size: 20px;">🔥 Top Actionable Suggestions</h3>
                    <div style="background: rgba(139, 92, 246, 0.05); border-left: 4px solid #8b5cf6; padding: 20px; border-radius: 0 8px 8px 0; margin-bottom: 30px;">
                        <ul style="color: #e2e8f0; line-height: 1.8; margin: 0; padding-left: 20px;">
                            {''.join(f'<li style="margin-bottom: 8px;">{s}</li>' for s in suggestions)}
                        </ul>
                    </div>
                    
                    <!-- LINE BY LINE REWRITES -->
                    <h3 style="color: #10b981; border-bottom: 2px solid rgba(16, 185, 129, 0.2); padding-bottom: 10px; margin-top: 40px; font-size: 20px;">✍️ Line-by-Line AI Rewrites</h3>
                    <p style="color: #94a3b8; font-size: 14px; margin-bottom: 20px;">Our AI detected passive phrasing in your resume and generated high-impact, metric-driven alternatives.</p>
        """
        
        for item in feedback:
            html_content += f"""
                    <div style="background-color: rgba(30, 41, 59, 0.6); padding: 20px; border-radius: 10px; margin-bottom: 20px; border: 1px solid #334155; position: relative;">
                        <span style="position: absolute; top: 10px; right: 15px; font-size: 12px; color: #64748b; background: rgba(0,0,0,0.3); padding: 3px 8px; border-radius: 10px;">{item.get('section', 'Section')}</span>
                        <div style="margin-bottom: 15px;">
                            <strong style="color: #ef4444; display: block; margin-bottom: 5px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">✖ Weak Original</strong>
                            <div style="color: #cbd5e1; font-size: 15px; font-style: italic; padding-left: 10px; border-left: 2px solid #ef4444;">"{item.get('before', '')}"</div>
                        </div>
                        <div>
                            <strong style="color: #10b981; display: block; margin-bottom: 5px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">✔ ATS Optimized</strong>
                            <div style="color: #f8fafc; font-size: 15px; padding-left: 10px; border-left: 2px solid #10b981;">"{item.get('after', '')}"</div>
                        </div>
                    </div>
            """
            
        html_content += f"""
                    <div style="text-align: center; margin-top: 50px; padding-top: 30px; border-top: 1px solid #1e293b;">
                        <h4 style="color: #e2e8f0; font-size: 18px; margin-top: 0;">Ready to apply these changes?</h4>
                        <p style="color: #94a3b8; margin-bottom: 25px; font-size: 14px;">Return to your dashboard to use the Live Editor and instantly rescan your document to see your new score.</p>
                        <a href="http://localhost:5000" style="background: linear-gradient(90deg, #8b5cf6 0%, #06b6d4 100%); color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px; display: inline-block; box-shadow: 0 4px 15px rgba(139, 92, 246, 0.4); text-transform: uppercase; letter-spacing: 0.5px;">Return to Dashboard</a>
                    </div>
                </div>
                
                <!-- FOOTER -->
                <div style="background-color: rgba(15, 23, 42, 0.8); padding: 20px; text-align: center; border-top: 1px solid #1e293b;">
                    <p style="color: #64748b; font-size: 12px; margin: 0;">© 2026 Smart Resume Analyzer. All rights reserved.</p>
                    <p style="color: #475569; font-size: 10px; margin-top: 5px;">This email was sent to {user_email} because you uploaded a document to our servers.</p>
                </div>
            </div>
        </body>
        </html>
        """
        
        msg = EmailMessage()
        msg['Subject'] = f'📊 Your Resume Screen Completed: Score {score}/100'
        msg['From'] = smtp_email
        msg['To'] = user_email
        msg.set_content("Please enable HTML to view this report.")
        msg.add_alternative(html_content, subtype='html')
        
        with smtplib.SMTP_SSL('smtp.gmail.com', 465) as smtp:
            smtp.login(smtp_email, smtp_pwd)
            smtp.send_message(msg)
            
        print(f"📧 Successfully sent DETAILED analysis email to {user_email}")
        return True
    except Exception as e:
        print(f"❌ Failed to send DETAILED analysis email to {user_email}: {str(e)}")
        return False

QUESTIONS_DB_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads', 'questions.json')

def load_questions():
    if os.path.exists(QUESTIONS_DB_FILE):
        try:
            with open(QUESTIONS_DB_FILE, 'r') as f:
                return json.load(f)
        except:
            return []
    return []

def save_questions(q_list):
    try:
        # Save up to 50 questions to avoid huge files
        with open(QUESTIONS_DB_FILE, 'w') as f:
            json.dump(q_list[:50], f, indent=4)
    except:
        pass

@app.route('/api/questions', methods=['GET'])
def get_questions():
    return jsonify({"success": True, "questions": load_questions()}), 200

@app.route('/api/questions', methods=['POST'])
def add_question():
    data = request.get_json()
    if not data or not data.get('text'):
        return jsonify({"error": "No text provided"}), 400
        
    q_list = load_questions()
    new_q = {
        "id": str(uuid.uuid4()),
        "name": data.get('name', 'Anonymous User'),
        "picture": data.get('picture', ''),
        "text": data.get('text'),
        "timestamp": time.time()
    }
    
    # AI Automatic Reply Logic
    ai_reply_text = ""
    try:
        if genai:
            client = genai.Client()
            system_prompt = "You are the ResumeAI Assistant, a friendly and professional expert on Applicant Tracking Systems (ATS), resume optimization, and the platform. Give a conversational, helpful, 2-line response to the user's community question."
            response = client.models.generate_content(
                model='gemini-2.5-flash',
                contents=f"User asked: {data.get('text')}",
                config=types.GenerateContentConfig(system_instruction=system_prompt, temperature=0.7)
            )
            ai_reply_text = response.text.strip()
    except Exception as e:
        print("AI Review Reply failed:", e)
        
    if ai_reply_text:
        new_q['ai_reply'] = ai_reply_text

    q_list.insert(0, new_q)
    save_questions(q_list)
    return jsonify({"success": True, "question": new_q}), 201

USERS_DB_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads', 'users_db.json')

def load_users():
    if os.path.exists(USERS_DB_FILE):
        try:
            with open(USERS_DB_FILE, 'r') as f:
                return json.load(f)
        except:
            return {}
    return {}

def save_users(users):
    base_dir = os.path.dirname(os.path.abspath(__file__))
    upload_dir = os.path.join(base_dir, 'uploads')
    if not os.path.exists(upload_dir):
        os.makedirs(upload_dir)
    with open(USERS_DB_FILE, 'w') as f:
        json.dump(users, f, indent=4)

@app.route('/api/auth/google', methods=['POST'])
def google_auth():
    data = request.get_json()
    token = data.get('token')
    
    if not token:
        return jsonify({"error": "No token provided"}), 400
        
    try:
        # Verify the Google Token Signature
        # Note: In a real production app, YOU MUST supply the actual Client ID here to verify correctly.
        # Check against the Client ID if you have it
        if GOOGLE_CLIENT_ID != "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com":
             idinfo = id_token.verify_oauth2_token(token, google_requests.Request(), GOOGLE_CLIENT_ID)
        else:
             # WARNING: Decoding without signature verification ONLY because you didn't provide the Client ID yet!
             # Once you provide the Client ID above, it will verify it securely.
             from google.auth import jwt
             idinfo = jwt.decode(token, verify=False)
        
        email = idinfo.get('email')
        name = idinfo.get('name')
        picture = idinfo.get('picture')
        
        users = load_users()
        
        is_new_user = False
        if email not in users:
            is_new_user = True
            users[email] = {
                "name": name,
                "picture": picture,
                "joined": time.time()
            }
            save_users(users)
            
            # Trigger Welcome Email securely on the backend!
            send_welcome_email(email, name)
            
        return jsonify({
            "success": True,
            "user": {
                "email": email,
                "name": name,
                "picture": picture,
                "is_new": is_new_user
            }
        }), 200
        
    except ValueError as e:
        print("❌ Invalid Google Auth token:", e)
        return jsonify({"error": "Invalid token"}), 401
    except Exception as e:
        print("❌ Google Auth error:", e)
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    print("\n✅ Python OFFLINE Backend is running on http://localhost:5000")
    print("Ready to receive requests! (NO API KEY REQUIRED OUT OF THE BOX!)")
    app.run(port=5000, debug=True)
