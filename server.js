const express = require('express');
const { Resend } = require('resend');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Resend using Render's environment variable (or hardcoded key for local testing)
const resend = new Resend(process.env.RESEND_API_KEY);

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Temporary in-memory store for verification codes: { "email@example.com": "123456" }
const pendingVerifications = new Map();

// Endpoint 1: Send 6-digit verification code to user's email
app.post('/api/send-verification', async (req, res) => {
  const { email } = req.body;

  if (!email || !email.includes('@')) {
    return res.status(400).json({ success: false, error: 'Please enter a valid email address.' });
  }

  // Generate random 6-digit code
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  pendingVerifications.set(email.toLowerCase().trim(), code);

  try {
    await resend.emails.send({
      from: 'BHESS Chess <onboarding@resend.dev>',
      to: [email.trim()],
      subject: 'Your BHESS Verification Code',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
          <h2 style="color: #111;">Welcome to BHESS!</h2>
          <p>Your 6-digit verification code is:</p>
          <h1 style="background: #111827; color: #4ade80; display: inline-block; padding: 12px 24px; border-radius: 8px; letter-spacing: 4px;">${code}</h1>
          <p style="color: #666; font-size: 14px; margin-top: 20px;">If you did not request this code, you can safely ignore this email.</p>
        </div>
      `
    });

    res.json({ success: true, message: 'Verification code sent!' });
  } catch (err) {
    console.error('Resend Email Error:', err);
    res.status(500).json({ success: false, error: 'Failed to send verification email. Please check the email address.' });
  }
});

// Endpoint 2: Verify the 6-digit code entered by user
app.post('/api/verify-code', (req, res) => {
  const { email, code } = req.body;

  if (!email || !code) {
    return res.status(400).json({ success: false, error: 'Email and code are required.' });
  }

  const formattedEmail = email.toLowerCase().trim();
  const savedCode = pendingVerifications.get(formattedEmail);

  if (savedCode && savedCode === code.trim()) {
    pendingVerifications.delete(formattedEmail); // Delete code after successful verification
    return res.json({ success: true, message: 'Email verified successfully!' });
  }

  res.status(400).json({ success: false, error: 'Incorrect or expired verification code.' });
});

// Serve public/index.html for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`BHESS Server running on port ${PORT}`);
});
