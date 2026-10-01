require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const nodemailer = require("nodemailer");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public")); // Serves index.html from the public folder

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

// In-memory global data storage
const users = []; // Stores registered accounts: [{ username, email, verified }]
const pendingVerifications = {}; // Stores pending codes: { email: { code, username, expiresAt } }
const activePlayers = {}; // Stores live players: { socketId: { id, username, x, y, color } }

// Configure Nodemailer using environment variables from Render
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Step 1: Request 6-Digit Email Verification Code
app.post("/api/request-code", async (req, res) => {
  const { username, email } = req.body;

  if (!username || !email) {
    return res.status(400).json({ error: "Username and email are required." });
  }

  const cleanEmail = email.trim().toLowerCase();
  const cleanUsername = username.trim().toLowerCase();

  // Check if username OR email is already registered globally
  const existingUser = users.find(
    (u) => u.email === cleanEmail || u.username.toLowerCase() === cleanUsername
  );

  if (existingUser) {
    if (existingUser.email === cleanEmail && existingUser.username.toLowerCase() === cleanUsername) {
      return res.status(400).json({ error: "Both this username and email are already registered." });
    } else if (existingUser.email === cleanEmail) {
      return res.status(400).json({ error: "This email address is already in use by another account." });
    } else {
      return res.status(400).json({ error: "This username is already taken globally." });
    }
  }

  // Generate a random 6-digit verification code
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  pendingVerifications[cleanEmail] = {
    username: cleanUsername,
    code,
    expiresAt: Date.now() + 10 * 60 * 1000 // Code expires in 10 minutes
  };

  // Send real email via Nodemailer
  try {
    await transporter.sendMail({
      from: `"Multiplayer Game" <${process.env.EMAIL_USER}>`,
      to: cleanEmail,
      subject: "Your Game Verification Code",
      text: `Your verification code is: ${code}. It expires in 10 minutes.`,
      html: `<h2>Verification Code</h2><p>Your code is: <strong>${code}</strong></p><p>Expires in 10 minutes.</p>`
    });

    res.json({ success: true, message: "Verification code sent to your email." });
  } catch (err) {
    console.error("Email error:", err);
    res.status(500).json({ error: "Failed to send verification email. Check Render environment variables." });
  }
});

// Step 2: Verify Code and Register Account Globally
app.post("/api/verify-code", (req, res) => {
  const { email, code } = req.body;
  const cleanEmail = email.trim().toLowerCase();
  const pending = pendingVerifications[cleanEmail];

  if (!pending) {
    return res.status(400).json({ error: "No pending verification found for this email." });
  }

  if (Date.now() > pending.expiresAt) {
    delete pendingVerifications[cleanEmail];
    return res.status(400).json({ error: "Verification code has expired." });
  }

  if (pending.code !== code.trim()) {
    return res.status(400).json({ error: "Incorrect verification code." });
  }

  // Register user globally
  users.push({
    username: pending.username,
    email: cleanEmail,
    verified: true
  });

  delete pendingVerifications[cleanEmail];
  res.json({ success: true, message: "Account verified successfully!" });
});

// Step 3: Global Real-time Multiplayer Handling
io.on("connection", (socket) => {
  console.log(`Player connected: ${socket.id}`);

  // When a verified player joins the world
  socket.on("player:join", ({ username }) => {
    activePlayers[socket.id] = {
      id: socket.id,
      username,
      x: Math.floor(Math.random() * 500) + 50,
      y: Math.floor(Math.random() * 300) + 50,
      color: `hsl(${Math.random() * 360}, 70%, 50%)`
    };

    // Send existing player positions to the newly connected player
    socket.emit("game:state", activePlayers);

    // Notify all other connected browsers across the globe
    socket.broadcast.emit("player:joined", activePlayers[socket.id]);
  });

  // Relay player movements to all other connected clients
  socket.on("player:move", (position) => {
    if (activePlayers[socket.id]) {
      activePlayers[socket.id].x = position.x;
      activePlayers[socket.id].y = position.y;

      socket.broadcast.emit("player:moved", {
        id: socket.id,
        x: position.x,
        y: position.y
      });
    }
  });

  // Handle player disconnects
  socket.on("disconnect", () => {
    delete activePlayers[socket.id];
    io.emit("player:left", socket.id);
    console.log(`Player disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
