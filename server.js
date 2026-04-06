const express = require('express');
const cors = require('cors');
const multer = require('multer');

const app = express();
// Stores uploaded files temporarily in an 'uploads' folder
const upload = multer({ dest: 'uploads/' }); 

// VERY IMPORTANT: This disables CORS errors for your frontend
app.use(cors());
app.use(express.json());

// Main upload endpoint matching your frontend POST request
app.post('/api/upload', upload.single('resume'), (req, res) => {
    console.log('\n--- 🚀 New Analysis Request Received ---');
    console.log('Name:', req.body.name);
    console.log('Email:', req.body.email);
    console.log('File Uploaded:', req.file ? req.file.originalname : 'No file');

    // Simulate AI processing delay (2 seconds)
    setTimeout(() => {
        // Return a randomly generated high score
        const score = Math.floor(Math.random() * (98 - 75 + 1) + 75);
        
        // Mock payload structure that matches what script.js expects
        res.json({
            score: score,
            suggestions: [
                "Quantify your achievements (e.g., 'Increased sales by 20%').",
                "Add more industry-specific keywords to pass the ATS screening.",
                "Your formatting is clean, but consider reordering to highlight your most recent role.",
                "Replace generic verbs like 'helped' with action words like 'orchestrated' or 'spearheaded'."
            ]
        });
        
        console.log('✅ Analysis Sent back to Frontend!');
    }, 2000);
});

const PORT = 5000;
app.listen(PORT, () => {
    console.log(`\n✅ Mock Backend is running on http://localhost:${PORT}`);
    console.log(`Ready to receive requests from your Resume Analyzer frontend!`);
});
