document.addEventListener('DOMContentLoaded', () => {

    // Global Auth Guard
    window.requireLogin = function(e) {
        if (!localStorage.getItem('smart_resume_user') && !window.adminPin) {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            const modal = document.getElementById('authRequiredModal');
            if (modal) {
                modal.classList.add('active');
                if (window.lucide) lucide.createIcons();
            }
            return false;
        }
        return true;
    };

    // Sticky Navbar Logic
    const navbar = document.getElementById('navbar');
    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }
    });

    // Reveal elements on scroll
    const reveals = document.querySelectorAll('.reveal');
    const revealOnScroll = () => {
        const windowHeight = window.innerHeight;
        const elementVisible = 100;

        reveals.forEach(reveal => {
            const elementTop = reveal.getBoundingClientRect().top;
            if (elementTop < windowHeight - elementVisible) {
                reveal.classList.add('active');
            }
        });
    };
    
    // Trigger once on page load
    revealOnScroll();
    window.addEventListener('scroll', revealOnScroll);

    // Form Submission to Real Server with Fetch
    const leadForm = document.getElementById('leadForm');
    const formError = document.getElementById('form-error');
    const resultsSection = document.getElementById('resultsSection');
    const submitBtn = leadForm.querySelector('button[type="submit"]');
    const resetFormBtn = document.getElementById('resetFormBtn');

    leadForm.addEventListener('submit', async (e) => {
        if (!window.requireLogin(e)) return;
        e.preventDefault();
        
        // Disable button & change text to simulate loading
        const originalText = submitBtn.innerHTML;
        submitBtn.innerHTML = 'Analyzing... <i data-lucide="loader-2" class="lucide-spin"></i>';
        submitBtn.disabled = true;
        
        if (formError) formError.classList.add('hidden');
        
        if(window.lucide) {
            lucide.createIcons();
        }

        try {
            const formData = new FormData();
            formData.append('name', document.getElementById('name').value);
            
            // Prefer the Google Logged-In email if the form input is empty!
            let userEmail = document.getElementById('email').value;
            const savedUserStr = localStorage.getItem('smart_resume_user');
            if (!userEmail && savedUserStr) {
                try {
                    const parsed = JSON.parse(savedUserStr);
                    userEmail = parsed.email || userEmail;
                } catch(e){}
            }
            formData.append('email', userEmail);
            
            const fileInput = document.getElementById('resume');
            if (fileInput.files.length > 0) {
                formData.append('resume', fileInput.files[0]);
            }

            let data;
            try {
                const response = await fetch('/api/upload', {
                    method: 'POST',
                    body: formData
                });

                if (!response.ok) {
                    throw new Error(`Server returned ${response.status}`);
                }
                data = await response.json();
            } catch (err) {
                console.warn("Backend not detected, engaging CLIENT-SIDE AI PARSER...", err);
                
                let fileText = "";
                // If the user uploaded a file, we extract it literally directly in the browser!
                if (fileInput.files.length > 0 && typeof pdfjsLib !== 'undefined') {
                    try {
                        const file = fileInput.files[0];
                        if (file.name.toLowerCase().endsWith('.pdf')) {
                            const arrayBuffer = await file.arrayBuffer();
                            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
                            const pdf = await pdfjsLib.getDocument({data: arrayBuffer}).promise;
                            for (let i = 1; i <= pdf.numPages; i++) {
                                const page = await pdf.getPage(i);
                                const textContent = await page.getTextContent();
                                fileText += textContent.items.map(s => s.str).join(" ") + "\n";
                            }
                        } else if (file.name.toLowerCase().endsWith('.docx') && typeof mammoth !== 'undefined') {
                            const arrayBuffer = await file.arrayBuffer();
                            const result = await mammoth.extractRawText({arrayBuffer: arrayBuffer});
                            fileText = result.value;
                        } else {
                            fileText = await file.text(); // text or rtf logic fallback
                        }
                    } catch(e) {
                         console.error("Local PDF parsing failed:", e);
                    }
                }
                
                if (fileText.length < 10) fileText = "Missing Document Content. The local parser failed to read standard text.";

                // Run Heuristics explicitly on the uploaded text!
                const cleanStart = fileText.trim().replace(/^[^a-zA-Z]+/, '');
                const nameMatch = cleanStart.match(/^([A-Z][a-zA-Z]+)\s+([A-Z][a-zA-Z]+)/) || fileText.match(/^([A-Z][a-z]+)\s+([A-Z][a-z]+)/m);
                let inputName = null;
                if (nameMatch) {
                    inputName = nameMatch[1] + " " + nameMatch[2];
                } else {
                    inputName = fileText.trim().split(/\s+/).slice(0, 2).join(" ") || "Candidate Name Not Found";
                }

                // Scan the physical document text for a real email
                const emailMatch = fileText.match(/([a-zA-Z0-9_\-\.]+)@([a-zA-Z0-9_\-\.]+)\.([a-zA-Z]{2,5})/);
                const extractedEmail = emailMatch ? emailMatch[0] : null;
                const inputEmail = extractedEmail || document.getElementById('email').value || "No Email Found";
                
                const textClean = fileText.toLowerCase();
                const commonSkills = ['python', 'java', 'c++', 'javascript', 'react', 'angular', 'node.js', 'html', 'css', 'sql', 'mysql', 'postgresql', 'mongodb', 'aws', 'docker', 'kubernetes', 'git', 'machine learning', 'data analysis', 'excel', 'project management', 'agile', 'scrum', 'sales', 'marketing', 'leadership', 'communication'];
                const foundSkills = commonSkills.filter(s => textClean.includes(s)).map(s => s.charAt(0).toUpperCase() + s.slice(1));
                
                const projectNames = [];
                const projMatches = [...fileText.matchAll(/([A-Z][a-zA-Z\s\-]+?)\s+(Project|App\b|Application|System|Platform)/gi)];
                projMatches.forEach(m => {
                    let proj = m[1].trim();
                    if (proj.split(" ").length <= 4 && !projectNames.includes(proj)) projectNames.push(proj);
                });
                if(projectNames.length === 0 && textClean.includes('project')) projectNames.push("Portfolio Project");

                const certNames = [];
                const certMatches = [...fileText.matchAll(/(?:certified|certification)\s+([a-zA-Z0-9\s\-]+)|([a-zA-Z0-9\s\-]+?)\s+(?:Certification|Certificate)/gi)];
                certMatches.forEach(m => {
                    let cert = (m[1] || m[2]).trim();
                    if (cert.split(" ").length <= 5 && !certNames.includes(cert)) certNames.push(cert);
                });
                if(certNames.length === 0 && textClean.includes('certif')) certNames.push("Professional Certificate");

                // Determine Role Dynamically instead of hardcoding 'Corporate Specialist'
                const roles = ['Software Engineer', 'Developer', 'Data Scientist', 'Manager', 'Analyst', 'Consultant', 'Designer', 'Specialist', 'Administrator'];
                let detectedRole = "General Applicant";
                for (let r of roles) {
                    if (textClean.includes(r.toLowerCase())) {
                        detectedRole = r;
                        break;
                    }
                }
                if (textClean.includes('b.tech') || textClean.includes('bachelor of technology')) {
                     detectedRole = "Technology Graduate";
                }

                // Calculate score strictly based on document structure, length, & action verbs
                let dynamicScore = 0;
                let scoreExpl = [];
                const coreSections = [/Contact|Email|Phone/i, /Summary|Objective|Profile/i, /Education|Academic/i, /Experience|Work|Employment/i, /Skills/i, /Projects/i];
                let secCount = 0;
                coreSections.forEach(regex => {
                    if (regex.test(fileText)) secCount++;
                });
                // Reduced from 12 to 8 to naturally push normal resumes into the 50-70 range
                dynamicScore += secCount * 8; // 8 * 6 = 48 max
                scoreExpl.push(`[+${secCount * 8}] Found ${secCount}/6 Core Layout Sections`);
                
                // Add points for formatting density and length (Stricter curves)
                let lengthPts = 0;
                if (fileText.length > 800) lengthPts += 5;
                if (fileText.length > 2000) lengthPts += 10;
                if (fileText.length > 3000) lengthPts += 5;
                if (lengthPts > 0) {
                    dynamicScore += lengthPts;
                    scoreExpl.push(`[+${lengthPts}] Text Density & Depth`);
                }
                
                // Skill Keyword Density (stricter tiering)
                let skillPts = 0;
                if (foundSkills.length > 3) skillPts += 5;
                if (foundSkills.length > 8) skillPts += 5;
                if (foundSkills.length > 15) skillPts += 5;
                if (skillPts > 0) {
                    dynamicScore += skillPts;
                    scoreExpl.push(`[+${skillPts}] Hard-skill keyword metrics`);
                }
                
                // Active verbs bonus
                const actionVerbs = ['managed', 'developed', 'created', 'led', 'designed', 'optimized', 'spearheaded', 'implemented', 'orchestrated', 'executed', 'built', 'transformed'];
                let verbsFound = 0;
                actionVerbs.forEach(v => {
                    if (textClean.includes(v)) verbsFound++;
                });
                let verbScore = Math.min(verbsFound * 3, 18); // Max 18 points for highly active verbs
                dynamicScore += verbScore;
                if (verbsFound > 0) scoreExpl.push(`[+${verbScore}] Strategic action-verbs (${verbsFound} found)`);
                
                // Boundaries and Penalties
                if (fileText.length < 300) { dynamicScore -= 40; scoreExpl.push(`[-40] CRITICAL PENALTY - Document too short/empty`); }
                if (dynamicScore > 99) dynamicScore = 99;
                if (dynamicScore < 15) dynamicScore = 15;
                
                let beforeScore = Math.max(15, dynamicScore - 20);
                
                const cgpaMatch = fileText.match(/\b(?:cgpa|gpa)\b[\s:=]*([0-9]\.[0-9]+|[0-9]{2}%)/i);
                const cgpa = cgpaMatch ? cgpaMatch[1] : null;
                
                // Get real sentences from user document for dynamic rewrites
                const sentences = fileText.replace(/\n/g, ' ').split(/(?<=[.!?])\s+/).filter(s => s.length > 25 && s.length < 120);
                const dynamicFeedback = [];
                if (sentences.length > 0) {
                    const before1 = sentences[0];
                    dynamicFeedback.push({
                        "section": "Experience", 
                        "before": before1.trim(), 
                        "after": "Optimized operations such that: " + before1.trim().toLowerCase() + " resulting in a 25% efficiency increase."
                    });
                } else {
                    dynamicFeedback.push({ "section": "Summary", "before": "Experienced professional looking for a new role.", "after": "Results-driven specialist with a proven track record of optimizing workflows and executing high-impact commercial solutions." });
                }
                
                if (sentences.length > 1) {
                    const before2 = sentences[Math.floor(sentences.length / 2)];
                    dynamicFeedback.push({
                        "section": "Projects", 
                        "before": before2.trim(), 
                        "after": "Spearheaded development initiatives prioritizing: " + before2.trim().toLowerCase() + " by integrating scalable workflows."
                    });
                } else {
                    dynamicFeedback.push({ "section": "Experience", "before": "Helped team do tasks and fix bugs.", "after": "Spearheaded issue-resolution protocols, actively collaborating across functional teams to reduce critical blockages by 35%." });
                }
                
                // Add Skills Rewrite
                const weakSkills = foundSkills.length > 0 ? foundSkills.slice(0,3).join(", ") : "Good at typing and computers";
                dynamicFeedback.push({
                    "section": "Skills",
                    "before": weakSkills.toLowerCase(),
                    "after": "Technical Competencies: " + weakSkills + ", featuring an emphasis on enterprise-level scalability."
                });
                
                // Add Certifications Rewrite
                const weakCert = certNames.length > 0 ? certNames[0] : "Certification of Completion";
                dynamicFeedback.push({
                    "section": "Certifications",
                    "before": weakCert,
                    "after": weakCert + " (Validated completion demonstrating continuous industry upskilling)"
                });

                const linkedinMatch = fileText.match(/linkedin\.com\/in\/[a-zA-Z0-9_\-]+/i);
                const linkedinUrl = linkedinMatch ? linkedinMatch[0] : "linkedin.com/in/candidate";

                data = {
                    "score": dynamicScore,
                    "scoreExplanation": scoreExpl,
                    "beforeScoreFallback": beforeScore,
                    "extractedData": { 
                        "name": inputName, 
                        "role": detectedRole, 
                        "emails": [inputEmail],
                        "linkedin": linkedinUrl,
                        "skills": foundSkills.length > 0 ? foundSkills : ["System Design", "Operations", "Critical Thinking"],
                        "projects": projectNames.length > 0 ? projectNames : ["No Specific Projects Parsed"],
                        "certifications": certNames.length > 0 ? certNames : ["No Certifications Parsed"],
                        "cgpa": cgpa
                    },
                    "rawTextSnippet": fileText,
                    "detailedFeedback": dynamicFeedback,
                    "suggestions": [
                        "Frontend browser AI dynamically modeled ATS metrics.",
                        "Identified several syntax heuristics effectively.",
                        "Ensure standard formatting to maximize algorithmic reading."
                    ]
                };
            }
            
            // Store results in browser memory (localStorage)
            localStorage.setItem("analysisData", JSON.stringify(data));
            
            // Push to History Vault Array
            let historyVault = JSON.parse(localStorage.getItem("resumeHistory")) || [];
            historyVault.unshift({
                name: document.getElementById('name').value || data.extractedData.name || "Anonymous",
                role: data.extractedData.role || "General Role",
                score: data.score,
                date: new Date().toLocaleDateString() + " " + new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
            });
            localStorage.setItem("resumeHistory", JSON.stringify(historyVault));
            
            window.open("analysis-result.html?v=" + new Date().getTime(), "_blank");
            leadForm.reset();
            // Re-initialize any new icons
            if (typeof lucide !== 'undefined') {
                lucide.createIcons();
            }
            
        } catch (error) {
            console.error('Upload failed:', error);
            if (formError) {
                formError.textContent = 'Analysis Failed. Is the local API running? ' + error.message;
                formError.classList.remove('hidden');
            }
        } finally {
            submitBtn.innerHTML = originalText;
            submitBtn.disabled = false;
            
            if(window.lucide) {
                lucide.createIcons();
            }
        }
    });

    if (resetFormBtn) {
        resetFormBtn.addEventListener('click', () => {
            leadForm.reset();
            resultsSection.classList.add('hidden');
            leadForm.classList.remove('hidden');
            
            const desc = document.querySelector('.form-desc');
            if (desc) desc.classList.remove('hidden');
            
            const uploadDummySpan = document.querySelector('.upload-dummy span');
            if (uploadDummySpan) uploadDummySpan.textContent = 'Click to upload PDF/DOCX';
            
            const uploadDummy = document.querySelector('.upload-dummy');
            if (uploadDummy) {
                uploadDummy.style.borderColor = 'var(--border-color)';
                uploadDummy.style.color = 'var(--text-secondary)';
            }
        });
    }

    // File Input Name display tweak
    const resumeInput = document.getElementById('resume');
    const uploadDummySpan = document.querySelector('.upload-dummy span');
    
    resumeInput.addEventListener('change', function() {
        if (this.files && this.files[0]) {
            uploadDummySpan.textContent = this.files[0].name;
            document.querySelector('.upload-dummy').style.borderColor = 'var(--accent-purple)';
            document.querySelector('.upload-dummy').style.color = 'white';
        } else {
            uploadDummySpan.textContent = 'Click to upload PDF/DOCX';
        }
    });

    // --- Resume Vault History Modal Logic ---
    const historyBtn = document.getElementById('historyBtn');
    const historyModal = document.getElementById('historyModal');
    const closeHistoryBtn = document.getElementById('closeHistoryBtn');
    const historyList = document.getElementById('historyList');

    if (historyBtn && historyModal) {
        historyBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const history = JSON.parse(localStorage.getItem("resumeHistory")) || [];
            if (history.length === 0) {
                historyList.innerHTML = '<div style="text-align: center; padding: 2rem 0; color: var(--text-secondary);"><i data-lucide="folder-open" style="width: 3rem; height: 3rem; opacity: 0.5; margin-bottom: 1rem; display: inline-block;"></i><p>No past resumes found. Upload your first one!</p></div>';
            } else {
                historyList.innerHTML = history.map((item, index) => `
                    <div class="history-item glow-effect" style="background: rgba(0,0,0,0.3); border: 1px solid var(--border-color); padding: 1.2rem; border-radius: 0.75rem; margin-bottom: 1rem; display: flex; justify-content: space-between; align-items: center;">
                        <div style="text-align: left;">
                            <h4 style="color: white; margin-bottom: 0.25rem;">${item.name}</h4>
                            <p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 0.25rem;">${item.role}</p>
                            <p style="font-size: 0.75rem; color: var(--accent-blue);"><i data-lucide="clock" style="width: 12px; height: 12px; vertical-align: middle; display: inline-block;"></i> ${item.date}</p>
                        </div>
                        <div style="background: ${item.score >= 70 ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)'}; color: ${item.score >= 70 ? '#22c55e' : '#ef4444'}; border: 1px solid ${item.score >= 70 ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}; padding: 0.5rem 1rem; border-radius: 50px; font-weight: bold; font-size: 1.25rem; min-width: 80px; text-align: center;">
                            ${item.score}
                        </div>
                    </div>
                `).join('');
            }
            if(window.lucide) { lucide.createIcons(); }
            
            historyModal.style.display = 'flex';
            historyModal.classList.remove('hidden');
        });

        closeHistoryBtn.addEventListener('click', () => {
            historyModal.style.display = 'none';
            historyModal.classList.add('hidden');
        });

        // Close on outside click
        window.addEventListener('click', (e) => {
            if (e.target === historyModal) {
                historyModal.style.display = 'none';
                historyModal.classList.add('hidden');
            }
        });
    }

    // --- Dynamic Reviews API Logic ---
    const loadReviews = async () => {
        const grid = document.getElementById('dynamic-reviews-grid');
        if (!grid) return;
        try {
            const res = await fetch('/api/reviews');
            const reviews = await res.json();
            
            // Reverse the array so the newest reviews appear first
            reviews.reverse();

            if (reviews.length === 0) {
                grid.innerHTML = '<p style="color:var(--text-secondary); text-align:center; grid-column: 1 / -1;">No reviews yet. Be the first!</p>';
                return;
            }
            grid.innerHTML = reviews.map((r, i) => `
                <div class="testimonial-card reveal ${i > 0 && i%2===0 ? 'reveal-delay-2' : i>0 ? 'reveal-delay-1' : ''} active" style="transition: all 0.3s ease; position: relative;">
                    ${r.admin_liked ? '<div style="position: absolute; top: -15px; right: -10px; background: #0f172a; border: 1px solid #ef4444; border-radius: 50%; padding: 8px; box-shadow: 0 0 15px rgba(239,68,68,0.4); font-size: 1.5rem; z-index: 10;">❤️</div>' : ''}
                    <div style="color: #fbbf24; margin-bottom: 1rem;">
                        ${Array(r.rating).fill('<i data-lucide="star" style="fill: #fbbf24; width: 18px;"></i>').join('')}
                    </div>
                    <p class="quote">"${r.quote}"</p>
                    <div class="author">
                        <strong>${r.name}</strong>
                        <span>${r.role}</span>
                    </div>
                    ${window.adminPin ? `<div style="position:absolute; bottom: 10px; right: 10px; display:flex; gap: 5px; z-index: 20;">
                        <button onclick="window.toggleReviewLike('${r.id}')" style="background: transparent; border: 1px solid #ef4444; color: #ef4444; border-radius: 4px; cursor: pointer; font-size: 0.8rem; padding: 2px 8px;">Toggle ❤️</button>
                        <button onclick="window.deleteReview('${r.id}')" style="background: transparent; border: 1px solid #64748b; color: #64748b; border-radius: 4px; cursor: pointer; font-size: 0.8rem; padding: 2px 8px;">Delete</button>
                    </div>` : ''}
                </div>
            `).join('');
            if(window.lucide) { lucide.createIcons(); }
        } catch(e) {
            console.error("Failed to load reviews", e);
        }
    };
    
    setTimeout(loadReviews, 300);

    // --- Payment Logic ---
    const getProBtn = document.getElementById('getProBtn');
    const getLifetimeBtn = document.getElementById('getLifetimeBtn');
    const paymentModal = document.getElementById('paymentModal');
    
    // Configurable UPI details. Hardcode your personal UPI ID here below!
    const upiID = "6302549529-2@axl"; 
    const payeeName = "Neelapu Mokshanya";
    
    const triggerPayment = (amount) => {
        const upiLink = `upi://pay?pa=${upiID}&pn=${encodeURIComponent(payeeName)}&am=${amount}&cu=INR`;
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        
        if (isMobile) {
            window.location.href = upiLink;
        } else {
            document.getElementById('displayUpiId').textContent = upiID;
            document.getElementById('qrCodeImage').src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(upiLink)}`;
            
            // Update WhatsApp link text depending on amount
            const waBtn = document.querySelector('#paymentModal a[href^="https://wa.me"]');
            if(waBtn) waBtn.href = `https://wa.me/916309899871?text=Hi!%20I%20just%20paid%20%E2%82%B9${amount}%20for%20the%20Resume%20Review.%20Here%20is%20my%20screenshot:`;
            
            paymentModal.style.display = 'flex';
            paymentModal.classList.remove('hidden');
        }
    };

    if (getProBtn) getProBtn.addEventListener('click', (e) => { if(!window.requireLogin(e)) return; triggerPayment("499"); });
    if (getLifetimeBtn) getLifetimeBtn.addEventListener('click', (e) => { if(!window.requireLogin(e)) return; triggerPayment("999"); });

    const closePaymentBtn = document.getElementById('closePaymentBtn');
    if (closePaymentBtn && paymentModal) {
        closePaymentBtn.addEventListener('click', () => {
            paymentModal.style.display = 'none';
            paymentModal.classList.add('hidden');
        });
    }

    // User Review Modal Logic
    const userReviewModal = document.getElementById('userReviewModal');
    const openReviewFormBtn = document.getElementById('openReviewFormBtn');
    const closeUserReviewBtn = document.getElementById('closeUserReviewBtn');
    if (openReviewFormBtn && userReviewModal) {
        openReviewFormBtn.addEventListener('click', (e) => {
            if (!window.requireLogin(e)) return;
            const userStr = localStorage.getItem('smart_resume_user');
            if (!userStr) {
                const warning = document.getElementById('review-login-warning');
                if (warning) {
                    warning.classList.remove('hidden');
                    setTimeout(() => warning.classList.add('hidden'), 3000);
                }
                return;
            }
            
            const user = JSON.parse(userStr);
            const nameInput = document.getElementById('reviewName');
            if(nameInput) {
                nameInput.value = user.name;
                nameInput.readOnly = true;
            }
            
            userReviewModal.style.display = 'flex';
            userReviewModal.classList.remove('hidden');
        });
        closeUserReviewBtn.addEventListener('click', () => {
            userReviewModal.style.display = 'none';
            userReviewModal.classList.add('hidden');
        });
    }

    const reviewSubmitForm = document.getElementById('reviewSubmitForm');
    const reviewStatus = document.getElementById('reviewStatus');
    if (reviewSubmitForm) {
        reviewSubmitForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            reviewStatus.textContent = "Submitting...";
            const payload = {
                name: document.getElementById('reviewName').value,
                role: document.getElementById('reviewRole').value,
                rating: parseInt(document.getElementById('reviewRating').value),
                quote: document.getElementById('reviewQuote').value
            };
            try {
                const res = await fetch('/api/reviews', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(payload)
                });
                const data = await res.json();
                if(res.ok) {
                    reviewStatus.style.color = '#22c55e';
                    reviewStatus.textContent = data.success;
                    reviewSubmitForm.reset();
                    setTimeout(() => {
                        userReviewModal.style.display = 'none';
                        userReviewModal.classList.add('hidden');
                        reviewStatus.textContent = "";
                    }, 2000);
                } else {
                    reviewStatus.style.color = '#ef4444';
                    reviewStatus.textContent = data.error || "Failed submit";
                }
            } catch(e) {
                reviewStatus.style.color = '#ef4444';
                reviewStatus.textContent = "Error connecting to server.";
            }
        });
    }

    // --- Admin Control Logic ---
    const adminLockBtn = document.getElementById('adminLockBtn');
    const adminAuthModal = document.getElementById('adminReviewAuthModal');
    const adminPanelModal = document.getElementById('adminReviewPanelModal');
    
    if (adminLockBtn && adminAuthModal && adminPanelModal) {
        adminLockBtn.addEventListener('click', () => {
            adminAuthModal.style.display = 'flex';
            adminAuthModal.classList.remove('hidden');
            document.getElementById('adminPassword').value = '';
        });
        
        document.getElementById('closeAdminAuthBtn').addEventListener('click', () => {
            adminAuthModal.style.display = 'none';
            adminAuthModal.classList.add('hidden');
        });
        document.getElementById('closeAdminPanelBtn').addEventListener('click', () => {
            adminPanelModal.style.display = 'none';
            adminPanelModal.classList.add('hidden');
            loadReviews(); // Refresh public reviews on close
        });

        const loadPendingReviews = async (password) => {
            try {
                const res = await fetch('/api/admin/reviews/pending', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({password})
                });
                if(!res.ok) throw new Error("Unauthorized");
                const pending = await res.json();
                const list = document.getElementById('pendingReviewsList');
                if(pending.length === 0) {
                    list.innerHTML = '<p style="color:var(--text-secondary);text-align:center;">No pending reviews!</p>';
                    return;
                }
                list.innerHTML = pending.map(r => `
                    <div style="background: rgba(0,0,0,0.5); padding: 1rem; border-radius: 8px; border: 1px solid var(--border);">
                        <p style="margin-bottom:5px; color:white;"><strong>${r.name}</strong> (${r.role}) - ${r.rating} Stars</p>
                        <p style="color: var(--text-secondary); margin-bottom: 10px;">"${r.quote}"</p>
                        <div style="display:flex; gap:10px;">
                            <button onclick="window.approveReview('${r.id}', '${password}')" style="background:#22c55e; color:black; font-weight:bold; border:none; padding:5px 15px; border-radius:4px; cursor:pointer;">Accept</button>
                            <button onclick="window.rejectReview('${r.id}', '${password}')" style="background:transparent; border:1px solid #ef4444; color:#ef4444; padding:5px 15px; border-radius:4px; cursor:pointer;">Reject</button>
                        </div>
                    </div>
                `).join('');
            } catch(e) {
                alert("Login Failed. Wrong PIN.");
                adminPanelModal.style.display = 'none';
                adminAuthModal.style.display = 'flex';
            }
        };

        window.approveReview = async (id, password) => {
            await fetch('/api/admin/reviews/approve', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({password, id})
            });
            loadPendingReviews(password);
        };
        window.rejectReview = async (id, password) => {
            await fetch('/api/admin/reviews/reject', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({password, id})
            });
            loadPendingReviews(password);
        };

        document.getElementById('loginAdminBtn').addEventListener('click', () => {
            const pwd = document.getElementById('adminPassword').value;
            window.adminPin = pwd;
            adminAuthModal.style.display = 'none';
            adminPanelModal.style.display = 'flex';
            adminPanelModal.classList.remove('hidden');
            loadPendingReviews(pwd);
            loadReviews(); // Refresh to show admin like buttons
            if (typeof loadQuestions === 'function') loadQuestions();
        });
    }

    window.toggleReviewLike = async (id) => {
        if (!window.adminPin) return;
        await fetch('/api/admin/reviews/like', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({password: window.adminPin, id})
        });
        loadReviews();
    };

    window.toggleQuestionLike = async (id) => {
        if (!window.adminPin) return;
        await fetch('/api/admin/questions/like', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({password: window.adminPin, id})
        });
        if (typeof loadQuestions === 'function') loadQuestions();
    };

    window.deleteReview = async (id) => {
        if (!window.adminPin || !confirm("Are you sure you want to delete this review?")) return;
        await fetch('/api/admin/reviews/reject', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({password: window.adminPin, id})
        });
        loadReviews();
    };

    window.deleteQuestion = async (id) => {
        if (!window.adminPin || !confirm("Are you sure you want to delete this question?")) return;
        await fetch('/api/admin/questions/delete', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({password: window.adminPin, id})
        });
        if (typeof loadQuestions === 'function') loadQuestions();
    };

    // ====== COMMUNITY Q&A LOGIC ======
    function loadQuestions() {
        const feed = document.getElementById('live-questions-feed');
        if (!feed) return;
        
        fetch('/api/questions')
            .then(res => res.json())
            .then(data => {
                if (data.success && data.questions) {
                    feed.innerHTML = '';
                    if (data.questions.length === 0) {
                        feed.innerHTML = '<p style="text-align: center; color: var(--text-secondary); width: 100%;">Be the first to ask a question!</p>';
                        return;
                    }
                    data.questions.forEach(q => {
                        const div = document.createElement('div');
                        div.style.cssText = "background: rgba(30,41,59,0.4); border-left: 3px solid var(--accent-blue); padding: 1rem; border-radius: 0 8px 8px 0; display: flex; gap: 1rem; text-align: left;";
                        div.innerHTML = `
                            <img src="${q.picture || ''}" style="width: 40px; height: 40px; border-radius: 50%; opacity: 0.9; object-fit: cover; background: #333;" onerror="this.src='https://ui-avatars.com/api/?name=User&background=random'">
                            <div style="flex: 1; position: relative;">
                                <strong style="color: #f8fafc; font-size: 0.95rem;">${q.name}</strong>
                                ${q.admin_liked ? '<span style="margin-left: 8px; background: rgba(239,68,68,0.2); border: 1px solid rgba(239,68,68,0.4); color: #ef4444; padding: 2px 8px; border-radius: 12px; font-size: 0.75rem; vertical-align: text-bottom; display: inline-block;">❤️ Admin Liked</span>' : ''}
                                <p style="color: var(--text-secondary); margin: 5px 0 0 0; font-size: 0.95rem; line-height: 1.5;">${q.text}</p>
                                ${window.adminPin ? `<div style="position:absolute; top: 0; right: 0; display:flex; gap: 5px; z-index: 20;">
                                    <button onclick="window.toggleQuestionLike('${q.id}')" style="background: transparent; border: 1px solid #ef4444; color: #ef4444; border-radius: 4px; cursor: pointer; font-size: 0.75rem; padding: 2px 8px;">Toggle ❤️</button>
                                    <button onclick="window.deleteQuestion('${q.id}')" style="background: transparent; border: 1px solid #64748b; color: #64748b; border-radius: 4px; cursor: pointer; font-size: 0.75rem; padding: 2px 8px;">Delete</button>
                                </div>` : ''}
                                
                                ${q.ai_reply ? `<div style="margin-top: 12px; background: rgba(56, 189, 248, 0.05); border-left: 2px solid #38bdf8; padding: 10px; border-radius: 0 8px 8px 0;"><strong style="color: #38bdf8; font-size: 0.85rem;">🤖 AI Assistant</strong><p style="color: #cbd5e1; margin: 4px 0 0 0; font-size: 0.85rem; line-height: 1.4;">${q.ai_reply}</p></div>` : ''}
                            </div>
                        `;
                        feed.appendChild(div);
                    });
                }
            }).catch(err => console.error("Failed to load Q&A", err));
    }

    const submitQaBtn = document.getElementById('submitQaBtn');
    if (submitQaBtn) {
        submitQaBtn.addEventListener('click', () => {
            const text = document.getElementById('qa-textbox').value.trim();
            if (!text) return;
            
            const userStr = localStorage.getItem('smart_resume_user');
            if (!userStr) return;
            
            const user = JSON.parse(userStr);
            submitQaBtn.textContent = 'Posting...';
            
            fetch('/api/questions', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    name: user.name,
                    picture: user.picture,
                    text: text
                })
            })
            .then(res => res.json())
            .then(data => {
                submitQaBtn.textContent = 'Post Message';
                if (data.success) {
                    document.getElementById('qa-textbox').value = '';
                    loadQuestions(); 
                } else {
                    alert("Failed to post message.");
                }
            })
            .catch(err => {
                console.error(err);
                submitQaBtn.textContent = 'Post Message';
            });
        });
        
        // Initial load
        loadQuestions();
    }

});
