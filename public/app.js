/* ==========================================================================
   GLOBAL STATE & CONFIGURATION
   ========================================================================== */
const game = new Chess();
let currentUser = null;
let currentAuthMode = 'register';
let currentMode = 'bot';
let botLevel = 400;
let playerColor = 'w';
let boardFlipped = false;
let selectedSquare = null;
let validMoves = [];

let timeWhite = 600;
let timeBlack = 600;
let initialTime = 600;
let clockTimer = null;
let isGameActive = false;

let mqttClient = null;
let currentRoomCode = null;

const PIECE_SYMBOLS = {
  w: { p: '♙', n: '♘', b: '♗', r: '♖', q: '♕', k: '♔' },
  b: { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' }
};

function playSound(type) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === 'move') {
      osc.frequency.setValueAtTime(400, ctx.currentTime);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
      osc.start(); osc.stop(ctx.currentTime + 0.1);
    } else if (type === 'capture') {
      osc.frequency.setValueAtTime(750, ctx.currentTime);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
      osc.start(); osc.stop(ctx.currentTime + 0.12);
    } else if (type === 'win') {
      osc.frequency.setValueAtTime(523.25, ctx.currentTime);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.start(); osc.stop(ctx.currentTime + 0.35);
    } else if (type === 'lose') {
      osc.frequency.setValueAtTime(220, ctx.currentTime);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.start(); osc.stop(ctx.currentTime + 0.35);
    }
  } catch(e) {}
}

/* ==========================================================================
   USER ACCOUNTS & RESEND EMAIL VERIFICATION SYSTEM
   ========================================================================== */
function getStoredAccounts() {
  const accs = localStorage.getItem('bhess_accounts');
  return accs ? JSON.parse(accs) : {};
}

function saveAccounts(accs) {
  localStorage.setItem('bhess_accounts', JSON.stringify(accs));
}

function findAccountByEmail(email) {
  if (!email) return null;
  const accounts = getStoredAccounts();
  const normalized = email.trim().toLowerCase();
  return Object.values(accounts).find(acc => acc.email && acc.email.toLowerCase() === normalized);
}

function loadUserAccount() {
  const stored = localStorage.getItem('bhess_active_user');
  if (stored) {
    currentUser = JSON.parse(stored);
  } else {
    currentUser = { username: 'Guest User', elo: 1200, wins: 0, losses: 0, draws: 0, history: [] };
  }
  updateUserUI();
}

function saveUserAccount() {
  if (currentUser) {
    localStorage.setItem('bhess_active_user', JSON.stringify(currentUser));
    if (currentUser.username !== 'Guest User') {
      const accounts = getStoredAccounts();
      accounts[currentUser.username.toLowerCase()] = currentUser;
      saveAccounts(accounts);
    }
  }
}

function updateUserUI() {
  const userDisplay = document.getElementById('user-display');
  const authOpenBtn = document.getElementById('btn-auth-open');

  if (currentUser && currentUser.username !== 'Guest User') {
    document.getElementById('user-display-name').innerText = currentUser.username;
    document.getElementById('user-display-elo').innerText = `${currentUser.elo} Elo`;
    userDisplay.classList.remove('hidden');
    authOpenBtn.classList.add('hidden');
  } else {
    userDisplay.classList.add('hidden');
    authOpenBtn.classList.remove('hidden');
  }
}

function openAuthModal() {
  document.getElementById('modal-auth').classList.remove('hidden');
  document.getElementById('auth-error').classList.add('hidden');
  setAuthMode('register');
}

function closeAuthModal() {
  document.getElementById('modal-auth').classList.add('hidden');
}

function setAuthMode(mode) {
  currentAuthMode = mode;
  const signinBtn = document.getElementById('auth-mode-signin');
  const registerBtn = document.getElementById('auth-mode-register');
  const emailField = document.getElementById('field-email');
  const submitBtn = document.getElementById('auth-submit-btn');
  const subtitle = document.getElementById('auth-subtitle');
  document.getElementById('auth-error').classList.add('hidden');

  if (mode === 'register') {
    registerBtn.className = "flex-1 py-1.5 text-xs font-bold rounded-lg bg-amber-500 text-slate-950 transition-all";
    signinBtn.className = "flex-1 py-1.5 text-xs font-bold rounded-lg text-slate-400 hover:text-white transition-all";
    emailField.classList.remove('hidden');
    submitBtn.innerText = "Verify Email & Create Account";
    subtitle.innerText = "Create an account using real 6-digit email verification";
  } else {
    signinBtn.className = "flex-1 py-1.5 text-xs font-bold rounded-lg bg-amber-500 text-slate-950 transition-all";
    registerBtn.className = "flex-1 py-1.5 text-xs font-bold rounded-lg text-slate-400 hover:text-white transition-all";
    emailField.classList.add('hidden');
    submitBtn.innerText = "Sign In";
    subtitle.innerText = "Welcome back! Enter your details to log in";
  }
}

async function handleGoogleSignIn() {
  const email = prompt("Enter your email address to receive a verification code:");
  if (!email || !email.includes('@')) {
    if (email) alert("Please enter a valid email address.");
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existingAccount = findAccountByEmail(normalizedEmail);

  if (existingAccount) {
    alert(`An account already exists on that email address (${normalizedEmail}) under username: "${existingAccount.username}".\n\nPlease switch to 'Sign In' instead.`);
    setAuthMode('signin');
    document.getElementById('auth-username').value = existingAccount.username;
    return;
  }

  // Request 6-digit verification code from server
  const sendRes = await fetch('/api/send-verification', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: normalizedEmail })
  });

  const sendData = await sendRes.json();
  if (!sendData.success) {
    alert(sendData.error || 'Failed to send verification email.');
    return;
  }

  const userCode = prompt(`We sent a 6-digit code to ${normalizedEmail}. Enter code to complete setup:`);
  if (!userCode) return;

  const verifyRes = await fetch('/api/verify-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: normalizedEmail, code: userCode.trim() })
  });

  const verifyData = await verifyRes.json();
  if (!verifyData.success) {
    alert(verifyData.error || 'Invalid verification code.');
    return;
  }

  let username = normalizedEmail.split('@')[0];
  const accounts = getStoredAccounts();
  let baseUsername = username;
  let counter = 1;

  while (accounts[username.toLowerCase()]) {
    username = `${baseUsername}${counter}`;
    counter++;
  }

  currentUser = {
    username: username,
    email: normalizedEmail,
    password: 'google_oauth_auth',
    elo: 1200,
    wins: 0,
    losses: 0,
    draws: 0,
    history: []
  };

  accounts[username.toLowerCase()] = currentUser;
  saveAccounts(accounts);
  saveUserAccount();
  updateUserUI();
  closeAuthModal();
  alert(`Email verified! Account created for ${currentUser.username} (${normalizedEmail}). You are now logged in!`);
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  const username = document.getElementById('auth-username').value.trim();
  const password = document.getElementById('auth-password').value.trim();
  const email = document.getElementById('auth-email').value.trim();
  const errorEl = document.getElementById('auth-error');

  errorEl.classList.add('hidden');
  const accounts = getStoredAccounts();
  const key = username.toLowerCase();

  if (currentAuthMode === 'register') {
    if (!email || !email.includes('@')) {
      errorEl.innerText = "Please enter a valid email address.";
      errorEl.classList.remove('hidden');
      return;
    }

    const existingEmailAccount = findAccountByEmail(email);
    if (existingEmailAccount) {
      errorEl.innerText = `An account already exists on that email (${email.toLowerCase()}). Please sign in instead!`;
      errorEl.classList.remove('hidden');
      return;
    }

    if (accounts[key]) {
      errorEl.innerText = "Username already exists. Switch to 'Sign In' or choose a new username.";
      errorEl.classList.remove('hidden');
      return;
    }

    // Send code to real email
    const sendRes = await fetch('/api/send-verification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email })
    });

    const sendData = await sendRes.json();
    if (!sendData.success) {
      errorEl.innerText = sendData.error || 'Failed to send verification email.';
      errorEl.classList.remove('hidden');
      return;
    }

    const userCode = prompt(`A 6-digit verification code was sent to ${email}. Enter it below:`);
    if (!userCode) return;

    const verifyRes = await fetch('/api/verify-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, code: userCode.trim() })
    });

    const verifyData = await verifyRes.json();
    if (!verifyData.success) {
      errorEl.innerText = verifyData.error || 'Invalid code. Registration canceled.';
      errorEl.classList.remove('hidden');
      return;
    }

    // Create Account & Auto Log In
    currentUser = {
      username: username,
      email: email.toLowerCase(),
      password: password,
      elo: 1200,
      wins: 0,
      losses: 0,
      draws: 0,
      history: []
    };
    accounts[key] = currentUser;
    saveAccounts(accounts);
    saveUserAccount();
    updateUserUI();
    closeAuthModal();
    alert('Email verified successfully! Your BHESS account is ready.');
  } else {
    // Sign In Validation
    if (!accounts[key]) {
      errorEl.innerText = "Account not found. Click 'Create Account' above to create one first!";
      errorEl.classList.remove('hidden');
      return;
    }
    if (accounts[key].password !== password) {
      errorEl.innerText = "Incorrect password. Please try again.";
      errorEl.classList.remove('hidden');
      return;
    }

    currentUser = accounts[key];
    saveUserAccount();
    updateUserUI();
    closeAuthModal();
  }
}

function continueAsGuest() {
  currentUser = { username: 'Guest User', elo: 1200, wins: 0, losses: 0, draws: 0, history: [] };
  localStorage.removeItem('bhess_active_user');
  updateUserUI();
  closeAuthModal();
}

function logoutUser() {
  localStorage.removeItem('bhess_active_user');
  currentUser = { username: 'Guest User', elo: 1200, wins: 0, losses: 0, draws: 0, history: [] };
  updateUserUI();
}

/* ==========================================================================
   TAB & UI NAVIGATION
   ========================================================================== */
function switchTab(mode) {
  currentMode = mode;
  const botBtn = document.getElementById('tab-bot');
  const onlineBtn = document.getElementById('tab-online');
  const botPanel = document.getElementById('bot-setup-panel');
  const onlinePanel = document.getElementById('online-setup-panel');

  if (mode === 'bot') {
    botBtn.className = "flex-1 py-2 text-xs font-bold rounded-xl bg-amber-500 text-slate-950 transition-all shadow-md";
    onlineBtn.className = "flex-1 py-2 text-xs font-bold rounded-xl text-slate-400 hover:text-white transition-all";
    botPanel.classList.remove('hidden');
    onlinePanel.classList.add('hidden');
  } else {
    onlineBtn.className = "flex-1 py-2 text-xs font-bold rounded-xl bg-amber-500 text-slate-950 transition-all shadow-md";
    botBtn.className = "flex-1 py-2 text-xs font-bold rounded-xl text-slate-400 hover:text-white transition-all";
    onlinePanel.classList.remove('hidden');
    botPanel.classList.add('hidden');
  }
}

function selectBotLevel(level) {
  botLevel = level;
  document.querySelectorAll('.bot-lvl-btn').forEach(btn => {
    btn.classList.remove('border-amber-500', 'bg-amber-500/10', 'text-amber-400');
    btn.classList.add('border-slate-700', 'bg-slate-800', 'text-slate-300');
  });
  const activeBtn = document.getElementById(`btn-bot-${level}`);
  if (activeBtn) {
    activeBtn.classList.remove('border-slate-700', 'bg-slate-800', 'text-slate-300');
    activeBtn.classList.add('border-amber-500', 'bg-amber-500/10', 'text-amber-400');
  }
}

function selectSide(color) {
  playerColor = color;
  boardFlipped = (color === 'b');
  const wBtn = document.getElementById('btn-side-w');
  const bBtn = document.getElementById('btn-side-b');

  if (color === 'w') {
    wBtn.className = "py-2.5 rounded-xl border border-amber-500 bg-amber-500/10 text-amber-400 font-bold text-xs flex items-center justify-center gap-2";
    bBtn.className = "py-2.5 rounded-xl border border-slate-700 bg-slate-800 text-slate-400 font-bold text-xs flex items-center justify-center gap-2 hover:border-slate-600";
  } else {
    bBtn.className = "py-2.5 rounded-xl border border-amber-500 bg-amber-500/10 text-amber-400 font-bold text-xs flex items-center justify-center gap-2";
    wBtn.className = "py-2.5 rounded-xl border border-slate-700 bg-slate-800 text-slate-400 font-bold text-xs flex items-center justify-center gap-2 hover:border-slate-600";
  }
}

/* ==========================================================================
   BOARD RENDERING & INTERACTION
   ========================================================================== */
function renderBoard() {
  const boardEl = document.getElementById('chess-board');
  boardEl.innerHTML = '';

  const boardState = game.board();
  const ranks = boardFlipped ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
  const files = boardFlipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];

  const inCheckSquare = game.in_check() ? findKingSquare(game.turn()) : null;

  ranks.forEach(r => {
    files.forEach(f => {
      const squareName = String.fromCharCode(97 + f) + (r + 1);
      const piece = boardState[7 - r][f];
      const isLight = (r + f) % 2 !== 0;

      const squareDiv = document.createElement('div');
      squareDiv.className = `board-square flex items-center justify-center relative cursor-pointer ${isLight ? 'square-light' : 'square-dark'}`;
      squareDiv.dataset.square = squareName;

      if (selectedSquare === squareName) {
        squareDiv.classList.add('square-selected');
      } else if (inCheckSquare === squareName) {
        squareDiv.classList.add('square-check');
      }

      if (piece) {
        const pieceSpan = document.createElement('span');
        pieceSpan.className = `text-4xl md:text-5xl select-none ${piece.color === 'w' ? 'text-slate-100 drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)]' : 'text-slate-900 drop-shadow-[0_1px_1px_rgba(255,255,255,0.4)]'}`;
        pieceSpan.innerText = PIECE_SYMBOLS[piece.color][piece.type];
        squareDiv.appendChild(pieceSpan);
      }

      if (validMoves.includes(squareName)) {
        const hint = document.createElement('div');
        hint.className = 'legal-hint absolute';
        squareDiv.appendChild(hint);
      }

      squareDiv.onclick = () => handleSquareClick(squareName);
      boardEl.appendChild(squareDiv);
    });
  });

  updateMoveHistory();
  updateMaterial();
}

function findKingSquare(color) {
  const boardState = game.board();
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const p = boardState[r][f];
      if (p && p.type === 'k' && p.color === color) {
        return String.fromCharCode(97 + f) + (8 - r);
      }
    }
  }
  return null;
}

function handleSquareClick(square) {
  if (!isGameActive) return;

  if (currentMode === 'bot' && game.turn() !== playerColor) return;
  if (currentMode === 'online' && game.turn() !== playerColor) return;

  if (selectedSquare) {
    const moveObj = { from: selectedSquare, to: square, promotion: 'q' };
    const move = game.move(moveObj);

    if (move) {
      playSound(move.captured ? 'capture' : 'move');
      selectedSquare = null;
      validMoves = [];
      renderBoard();

      if (currentMode === 'online') {
        publishMQTT('move', { move: moveObj });
      }

      if (checkGameOver()) return;

      if (currentMode === 'bot' && game.turn() !== playerColor) {
        setTimeout(makeBotMove, 400);
      }
      return;
    }
  }

  const piece = game.get(square);
  if (piece && piece.color === game.turn()) {
    selectedSquare = square;
    const moves = game.moves({ square: square, verbose: true });
    validMoves = moves.map(m => m.to);
  } else {
    selectedSquare = null;
    validMoves = [];
  }
  renderBoard();
}

/* ==========================================================================
   BOT AI ENGINE
   ========================================================================== */
function startBotGame() {
  game.reset();
  isGameActive = true;
  selectedSquare = null;
  validMoves = [];

  initialTime = parseInt(document.getElementById('bot-time-control').value);
  timeWhite = initialTime;
  timeBlack = initialTime;

  document.getElementById('player-name').innerText = `${currentUser.username} (${currentUser.elo})`;
  document.getElementById('opponent-name').innerText = `Bot (${botLevel} Elo)`;

  renderBoard();
  startClocks();

  if (playerColor === 'b') {
    setTimeout(makeBotMove, 500);
  }
}

function makeBotMove() {
  if (!isGameActive) return;

  const moves = game.moves({ verbose: true });
  if (moves.length === 0) return;

  let chosenMove = null;

  if (botLevel <= 400) {
    chosenMove = moves[Math.floor(Math.random() * moves.length)];
  } else {
    const captures = moves.filter(m => m.captured);
    if (captures.length > 0 && Math.random() < (botLevel / 2000)) {
      chosenMove = captures[Math.floor(Math.random() * captures.length)];
    } else {
      chosenMove = moves[Math.floor(Math.random() * moves.length)];
    }
  }

  const move = game.move(chosenMove);
  if (move) {
    playSound(move.captured ? 'capture' : 'move');
    renderBoard();
    checkGameOver();
  }
}

/* ==========================================================================
   TIMERS & MATERIAL CALCULATOR
   ========================================================================== */
function startClocks() {
  if (clockTimer) clearInterval(clockTimer);

  clockTimer = setInterval(() => {
    if (!isGameActive) return;

    if (game.turn() === 'w') {
      timeWhite--;
      if (timeWhite <= 0) handleGameOver(playerColor === 'w' ? 'LOSS_TIME' : 'WIN_TIME', 'By Timeout');
    } else {
      timeBlack--;
      if (timeBlack <= 0) handleGameOver(playerColor === 'b' ? 'LOSS_TIME' : 'WIN_TIME', 'By Timeout');
    }

    updateClockUI();
  }, 1000);
}

function updateClockUI() {
  const format = (s) => `${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}`;
  
  const pTimer = document.getElementById('timer-player');
  const oTimer = document.getElementById('timer-opponent');

  if (playerColor === 'w') {
    pTimer.innerText = format(timeWhite);
    oTimer.innerText = format(timeBlack);
  } else {
    pTimer.innerText = format(timeBlack);
    oTimer.innerText = format(timeWhite);
  }
}

function updateMaterial() {
  const values = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  let wScore = 0, bScore = 0;

  game.board().forEach(row => {
    row.forEach(p => {
      if (p) {
        if (p.color === 'w') wScore += values[p.type];
        else bScore += values[p.type];
      }
    });
  });

  const pMat = document.getElementById('player-material');
  const oMat = document.getElementById('opponent-material');

  const pDiff = playerColor === 'w' ? (wScore - bScore) : (bScore - wScore);
  const oDiff = -pDiff;

  pMat.innerText = `Material: ${pDiff > 0 ? '+' + pDiff : pDiff}`;
  oMat.innerText = `Material: ${oDiff > 0 ? '+' + oDiff : oDiff}`;
}

function updateMoveHistory() {
  const historyEl = document.getElementById('move-history');
  historyEl.innerHTML = '';
  const history = game.history();

  for (let i = 0; i < history.length; i += 2) {
    const moveNum = Math.floor(i / 2) + 1;
    const wMove = history[i] || '';
    const bMove = history[i + 1] || '';

    const item = document.createElement('div');
    item.className = 'col-span-2 grid grid-cols-6 text-slate-300 py-0.5 border-b border-slate-900';
    item.innerHTML = `<span class="col-span-1 text-slate-500">${moveNum}.</span><span class="col-span-2 font-bold">${wMove}</span><span class="col-span-3 text-slate-400">${bMove}</span>`;
    historyEl.appendChild(item);
  }
  historyEl.scrollTop = historyEl.scrollHeight;
}

function toggleFlipBoard() {
  boardFlipped = !boardFlipped;
  renderBoard();
}

function offerDraw() {
  if (!isGameActive) return;
  if (currentMode === 'online') {
    publishMQTT('draw_offer', {});
    alert('Draw offer sent to opponent.');
  } else {
    if (confirm('Accept draw offer with Bot?')) {
      handleGameOver('DRAW', 'By Mutual Agreement');
    }
  }
}

function promptResign() {
  if (!isGameActive) return;
  if (confirm('Are you sure you want to resign?')) {
    if (currentMode === 'online') publishMQTT('resign', {});
    handleGameOver('LOSS_RESIGN', 'By Resignation');
  }
}

/* ==========================================================================
   GAME OVER OVERLAY SCREEN & ELO RATING UPDATES
   ========================================================================== */
function checkGameOver() {
  if (!isGameActive) return false;

  if (game.in_checkmate()) {
    const winner = game.turn() === 'w' ? 'b' : 'w';
    if (winner === playerColor) {
      handleGameOver('WIN_CHECKMATE', 'By Checkmate');
    } else {
      handleGameOver('LOSS_CHECKMATE', 'By Checkmate');
    }
    return true;
  }

  if (game.in_draw() || game.in_stalemate() || game.in_threefold_repetition()) {
    handleGameOver('DRAW', game.in_stalemate() ? 'By Stalemate' : 'By Draw Rule');
    return true;
  }

  return false;
}

function handleGameOver(type, reasonText) {
  isGameActive = false;
  if (clockTimer) clearInterval(clockTimer);

  let resultOutcome = 'DRAW';
  let eloDelta = 0;

  if (type.startsWith('WIN')) {
    resultOutcome = 'WIN';
    eloDelta = 15;
    playSound('win');
  } else if (type.startsWith('LOSS')) {
    resultOutcome = 'LOSS';
    eloDelta = -12;
    playSound('lose');
  } else {
    resultOutcome = 'DRAW';
    eloDelta = 0;
  }

  if (currentUser && currentUser.username !== 'Guest User') {
    currentUser.elo = Math.max(100, currentUser.elo + eloDelta);
    if (resultOutcome === 'WIN') currentUser.wins++;
    else if (resultOutcome === 'LOSS') currentUser.losses++;
    else currentUser.draws++;

    const opponentName = currentMode === 'bot' ? `Bot (${botLevel})` : 'Online Opponent';
    currentUser.history.push({
      opponent: opponentName,
      result: resultOutcome,
      reason: reasonText,
      eloDelta: eloDelta,
      date: new Date().toLocaleDateString()
    });

    saveUserAccount();
    updateUserUI();
  }

  showGameOverModal(resultOutcome, reasonText, eloDelta);
}

function showGameOverModal(outcome, reason, eloDelta) {
  const modal = document.getElementById('modal-game-over');
  const iconBox = document.getElementById('game-over-icon-box');
  const title = document.getElementById('game-over-title');
  const reasonEl = document.getElementById('game-over-reason');
  const deltaEl = document.getElementById('game-over-elo-change');
  const newEloEl = document.getElementById('game-over-new-elo');

  if (outcome === 'WIN') {
    iconBox.innerHTML = '🏆';
    iconBox.className = 'w-20 h-20 mx-auto rounded-full flex items-center justify-center text-4xl mb-4 bg-gradient-to-tr from-emerald-600 to-green-400 text-white shadow-emerald-900/50 shadow-xl border border-emerald-300/30';
    title.innerText = 'YOU WIN! 🎉';
    title.className = 'text-3xl font-black tracking-tight mb-1 text-emerald-400';
  } else if (outcome === 'LOSS') {
    iconBox.innerHTML = '💔';
    iconBox.className = 'w-20 h-20 mx-auto rounded-full flex items-center justify-center text-4xl mb-4 bg-gradient-to-tr from-rose-600 to-red-500 text-white shadow-rose-900/50 shadow-xl border border-rose-300/30';
    title.innerText = 'YOU LOSE! 💔';
    title.className = 'text-3xl font-black tracking-tight mb-1 text-rose-500';
  } else {
    iconBox.innerHTML = '🤝';
    iconBox.className = 'w-20 h-20 mx-auto rounded-full flex items-center justify-center text-4xl mb-4 bg-gradient-to-tr from-amber-600 to-yellow-500 text-white shadow-amber-900/50 shadow-xl border border-amber-300/30';
    title.innerText = 'DRAW! 🤝';
    title.className = 'text-3xl font-black tracking-tight mb-1 text-amber-400';
  }

  reasonEl.innerText = reason;
  deltaEl.innerText = (eloDelta >= 0 ? '+' : '') + eloDelta + ' Elo';
  deltaEl.className = eloDelta >= 0 ? 'text-xl font-extrabold text-emerald-400' : 'text-xl font-extrabold text-rose-400';
  newEloEl.innerText = currentUser ? currentUser.elo : 1200;

  modal.classList.remove('hidden');
}

function closeGameOverModal() {
  document.getElementById('modal-game-over').classList.add('hidden');
}

/* ==========================================================================
   MULTIPLAYER MQTT WEBSOCKET CONNECTION
   ========================================================================== */
function createOnlineRoom() {
  const code = 'BHESS-' + Math.floor(1000 + Math.random() * 9000);
  currentRoomCode = code;

  const side = document.getElementById('online-side-choice').value;
  playerColor = side === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : side;
  initialTime = parseInt(document.getElementById('online-time-control').value);

  connectMQTT(code, true);
}

function joinOnlineRoom() {
  const code = document.getElementById('join-room-input').value.trim().toUpperCase();
  if (!code) {
    alert('Please enter a valid room code.');
    return;
  }

  currentRoomCode = code;
  connectMQTT(code, false);
}

function connectMQTT(roomCode, isHost) {
  if (mqttClient) mqttClient.end();

  mqttClient = mqtt.connect('wss://broker.hivemq.com:8884/mqtt');

  const topic = `bhess_dot_lom_v1/room/${roomCode}`;

  mqttClient.on('connect', () => {
    mqttClient.subscribe(topic);

    if (isHost) {
      alert(`Room Created! Share Code: ${roomCode}\nWaiting for opponent to connect...`);
    } else {
      publishMQTT('join', { sender: currentUser.username });
    }
  });

  mqttClient.on('message', (t, message) => {
    try {
      const payload = JSON.parse(message.toString());
      if (payload.sender === currentUser.username) return;

      handleMQTTMessage(payload, isHost);
    } catch (e) {
      console.error('MQTT Parsing error:', e);
    }
  });
}

function publishMQTT(type, extraData) {
  if (!mqttClient || !currentRoomCode) return;
  const topic = `bhess_dot_lom_v1/room/${currentRoomCode}`;
  const packet = JSON.stringify({
    type: type,
    sender: currentUser.username,
    ...extraData
  });
  mqttClient.publish(topic, packet);
}

function handleMQTTMessage(payload, isHost) {
  if (payload.type === 'join') {
    if (isHost) {
      publishMQTT('start', {
        hostColor: playerColor,
        timeControl: initialTime
      });
      startOnlineMatch(playerColor, payload.sender);
    }
  } else if (payload.type === 'start') {
    playerColor = payload.hostColor === 'w' ? 'b' : 'w';
    initialTime = payload.timeControl;
    startOnlineMatch(playerColor, payload.sender);
  } else if (payload.type === 'move') {
    game.move(payload.move);
    playSound('move');
    renderBoard();
    checkGameOver();
  } else if (payload.type === 'draw_offer') {
    document.getElementById('modal-draw-offer').classList.remove('hidden');
  } else if (payload.type === 'draw_response') {
    if (payload.accepted) {
      handleGameOver('DRAW', 'By Mutual Agreement');
    } else {
      alert('Opponent declined your draw offer.');
    }
  } else if (payload.type === 'resign') {
    handleGameOver('WIN_RESIGN', 'Opponent Resigned');
  }
}

function respondDrawOffer(accepted) {
  document.getElementById('modal-draw-offer').classList.add('hidden');
  publishMQTT('draw_response', { accepted });
  if (accepted) {
    handleGameOver('DRAW', 'By Mutual Agreement');
  }
}

function startOnlineMatch(assignedColor, opponentUsername) {
  switchTab('bot');
  game.reset();
  isGameActive = true;
  currentMode = 'online';
  playerColor = assignedColor;
  boardFlipped = (playerColor === 'b');

  timeWhite = initialTime;
  timeBlack = initialTime;

  document.getElementById('bot-setup-panel').classList.add('hidden');

  document.getElementById('player-name').innerText = `${currentUser.username} (${currentUser.elo})`;
  document.getElementById('opponent-name').innerText = `${opponentUsername}`;

  renderBoard();
  startClocks();
}

/* ==========================================================================
   INITIALIZATION ON WINDOW LOAD
   ========================================================================== */
window.onload = function() {
  loadUserAccount();
  switchTab('bot');
  selectBotLevel(400);
  selectSide('w');
  renderBoard();
};
