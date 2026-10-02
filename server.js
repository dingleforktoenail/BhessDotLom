const nodemailer = require('nodemailer');

// Configure the Gmail transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'yourgmail@gmail.com',            // Replace with your real Gmail address
    pass: process.env.GMAIL_APP_PASSWORD    // Pulled from your environment variables
  }
});

// Inside your email-sending endpoint/route:
app.post('/send-code', async (req, res) => {
  const { email, code } = req.body;

  try {
    await transporter.sendMail({
      from: '"BhessDotLom" <yourgmail@gmail.com>', // Sender address
      to: email,                                  // Works for ANY recipient address!
      subject: 'Your BHESS Verification Code',
      text: `Your verification code is: ${code}`,
      html: `<h3>Your BHESS Verification Code</h3><p><b>${code}</b></p>`
    });

    res.status(200).json({ success: true, message: 'Email sent successfully!' });
  } catch (error) {
    console.error('Nodemailer Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});
