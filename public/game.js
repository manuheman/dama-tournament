// Connect to Socket.IO with query params from URL
const qs = new URLSearchParams(window.location.search)
const fixtureIdParam = qs.get("fixtureId")
const userIdParam = qs.get("userId")
const tournamentIdParam = qs.get("tournamentId")
const socket = io({
  query: {
    fixtureId: new URLSearchParams(window.location.search).get("fixtureId"),
    userId: new URLSearchParams(window.location.search).get("userId"),
  },
});

const boardElement = document.getElementById("board");
const turnIndicator = document.getElementById("turn-indicator");
const messageElement = document.getElementById("message");
const timerElement = document.getElementById("timer");
const BOARD_SIZE = 8;




let audioEnabled = false;
document.addEventListener("click", () => {
  if (!audioEnabled) {
    const sounds = [
      "/sounds/game-start.mp3",
      "/sounds/move.wav",
      "/sounds/capture.wav",
      "/sounds/game-over.mp3",
    ];
    sounds.forEach((src) => new Audio(src).play().catch(() => {}));
    audioEnabled = true;
    console.log("Audio enabled after user interaction.");
  }
}, { once: true });

//game return auto winh
const returnBtn = document.getElementById("returnBtn");
const countdownEl = document.getElementById("countdown");
const waitingMessageEl = document.getElementById("waiting-message");

// Restore countdown state from localStorage
let remainingSeconds = Number(localStorage.getItem("countdownSeconds")) || 5 * 60;
let returnBtnEnabled = localStorage.getItem("returnBtnEnabled") === "true";
returnBtn.disabled = !returnBtnEnabled;

// Save countdown state
function saveCountdownState() {
  localStorage.setItem("countdownSeconds", remainingSeconds);
  localStorage.setItem("returnBtnEnabled", !returnBtn.disabled);
}

// Countdown interval
let interval = setInterval(() => {
  if (remainingSeconds <= 0) {
    clearInterval(interval);
    returnBtn.disabled = false;
    countdownEl.textContent = "";
    saveCountdownState();

    // Update waiting message when countdown ends
    if (waitingMessageEl) {
      waitingMessageEl.textContent = "Your opponent does not come, you win the match";
    }

    return;
  }

  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  countdownEl.textContent = `${minutes.toString().padStart(2,'0')}:${seconds.toString().padStart(2,'0')}`;

  remainingSeconds--;
  saveCountdownState();
}, 1000);

// Show waiting overlay
function showWaitingOverlay() {
  const overlay = document.getElementById("waiting-overlay");
  if (!overlay) return;

  overlay.style.display = "flex";
  remainingSeconds = Number(localStorage.getItem("countdownSeconds")) || 5 * 60;
  returnBtn.disabled = true;
  countdownEl.textContent = "05:00";
  saveCountdownState();

  // Reset waiting message when overlay is shown
  if (waitingMessageEl) {
    waitingMessageEl.textContent = "Waiting for opponent to join.. (up to 5 min max)";
  }
}

// Hide waiting overlay
function hideWaitingOverlay() {
  const overlay = document.getElementById("waiting-overlay");
  if (overlay) overlay.style.display = "none";

  countdownEl.textContent = "";
  returnBtn.disabled = false;
  saveCountdownState();
}

// Return button click
returnBtn.addEventListener("click", () => {
  const qs = new URLSearchParams(window.location.search);
  const userIdParam = qs.get("userId");

  localStorage.removeItem("countdownSeconds");
  localStorage.removeItem("returnBtnEnabled");

  window.location.href = `/user-dashboard.html?userId=${encodeURIComponent(userIdParam)}`;
});





//return to dashboard part
const returnDashBtn = document.getElementById("return-dashboard-btn")
if (returnDashBtn) {
  returnDashBtn.addEventListener("click", () => {
    try {
      const saved = sessionStorage.getItem("dashboardReturn")
      if (saved) {
        window.location.href = saved
        return
      }
    } catch {}
    if (userIdParam) {
      window.location.href = `/user-dashboard.html?userId=${encodeURIComponent(userIdParam)}`
    } else {
      history.back()
    }
  })
}



let board = [];
let selectedPiece = null;
let validMoves = [];
let currentPlayer = 1; // whose turn it is (1 or 2)
let myPlayerNumber = 0; // this client's player number (1 or 2)
let boardEnabled = false;

const directions = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];

function insideBoard(r, c) {
  return r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;
}

function emptyBoard() {
  return Array(BOARD_SIZE)
    .fill(null)
    .map(() => Array(BOARD_SIZE).fill(null));
}

function initializeBoardState() {
  const newBoard = emptyBoard();
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < BOARD_SIZE; c++)
      if ((r + c) % 2 === 1) newBoard[r][c] = { player: 2, king: false };
  for (let r = 5; r < 8; r++)
    for (let c = 0; c < BOARD_SIZE; c++)
      if ((r + c) % 2 === 1) newBoard[r][c] = { player: 1, king: false };
  return newBoard;
}

function setBoardState(newBoard) {
  board = newBoard;
  renderBoard();
}
//sound move
// Call this function whenever a move is made


function makeMove({ from, to, capture }) {
  // Move the piece
  board[to.row][to.col] = board[from.row][from.col];
  board[from.row][from.col] = null;

  // Remove captured piece
  if (capture) board[capture.row][capture.col] = null;

  const piece = board[to.row][to.col];

  // Check if piece has further captures in the same move
  const furtherCaptures = getValidMoves(to.row, to.col).filter(m => m.capture);

  if (!piece.king && furtherCaptures.length === 0) {
    const reachedEnd =
      (piece.player === 1 && to.row === 0) ||
      (piece.player === 2 && to.row === BOARD_SIZE - 1);
    if (reachedEnd) {
      piece.king = true;
      messageElement.textContent = `Piece promoted to King!`;
    }
  }
}

function getValidMoves(r, c) {
  const p = board[r][c];
  if (!p) return [];
  let moves = [];
  if (p.king) {
    for (const [dr, dc] of directions) {
      let rr = r + dr,
        cc = c + dc;
      while (insideBoard(rr, cc) && board[rr][cc] === null) {
        moves.push({
          from: { row: r, col: c },
          to: { row: rr, col: cc },
          capture: null,
        });
        rr += dr;
        cc += dc;
      }
      if (
        insideBoard(rr, cc) &&
        board[rr][cc] &&
        board[rr][cc].player !== p.player
      ) {
        let rrr = rr + dr,
          ccc = cc + dc;
        while (insideBoard(rrr, ccc) && board[rrr][ccc] === null) {
          moves.push({
            from: { row: r, col: c },
            to: { row: rrr, col: ccc },
            capture: { row: rr, col: cc },
          });
          rrr += dr;
          ccc += dc;
        }
      }
    }
  } else {
    const captureDirs = directions;
    for (const [dr, dc] of captureDirs) {
      const r1 = r + dr,
        c1 = c + dc,
        r2 = r + 2 * dr,
        c2 = c + 2 * dc;
      if (
        insideBoard(r2, c2) &&
        board[r1][c1] &&
        board[r1][c1].player !== p.player &&
        board[r2][c2] === null
      ) {
        moves.push({
          from: { row: r, col: c },
          to: { row: r2, col: c2 },
          capture: { row: r1, col: c1 },
        });
      }
    }
    if (moves.length) return moves;
    const fwdDirs =
      p.player === 1
        ? [
            [-1, -1],
            [-1, 1],
          ]
        : [
            [1, -1],
            [1, 1],
          ];
    for (const [dr, dc] of fwdDirs) {
      const r1 = r + dr,
        c1 = c + dc;
      if (insideBoard(r1, c1) && board[r1][c1] === null) {
        moves.push({
          from: { row: r, col: c },
          to: { row: r1, col: c1 },
          capture: null,
        });
      }
    }
  }
  return moves;
}

function hasFurtherCapture(r, c) {
  const p = board[r][c];
  if (!p) return false;
  if (p.king) {
    for (const [dr, dc] of directions) {
      let rr = r + dr,
        cc = c + dc;
      while (insideBoard(rr, cc) && board[rr][cc] === null) {
        rr += dr;
        cc += dc;
      }
      if (
        insideBoard(rr, cc) &&
        board[rr][cc] &&
        board[rr][cc].player !== p.player
      ) {
        let rrr = rr + dr,
          ccc = cc + dc;
        while (insideBoard(rrr, ccc)) {
          if (board[rrr][ccc] === null) return true;
          else break;
        }
      }
    }
  } else {
    const fwdDirs =
      p.player === 1
        ? [
            [-1, -1],
            [-1, 1],
          ]
        : [
            [1, -1],
            [1, 1],
          ];
    for (const [dr, dc] of fwdDirs) {
      const r1 = r + dr,
        c1 = c + dc,
        r2 = r + 2 * dr,
        c2 = c + 2 * dc;
      if (
        insideBoard(r2, c2) &&
        board[r1][c1] &&
        board[r1][c1].player !== p.player &&
        board[r2][c2] === null
      )
        return true;
    }
  }
  return false;
}

function playerHasCaptureMoves() {
  for (let r = 0; r < BOARD_SIZE; r++)
    for (let c = 0; c < BOARD_SIZE; c++) {
      const p = board[r][c];
      if (
        p &&
        p.player === currentPlayer &&
        getValidMoves(r, c).some((m) => m.capture)
      )
        return true;
    }
  return false;
}

function playerHasPieces(player) {
  return board.some((row) => row.some((p) => p && p.player === player));
}

function playerHasAnyValidMoves(player) {
  for (let r = 0; r < BOARD_SIZE; r++)
    for (let c = 0; c < BOARD_SIZE; c++) {
      const p = board[r][c];
      if (p && p.player === player && getValidMoves(r, c).length > 0)
        return true;
    }
  return false;
}

function getPlayerName(n) {
  return n === myPlayerNumber ? "You" : "Opponent";
}

// TIMER DISPLAY
function displayTimer(sec) {
  if (sec === null || sec === undefined) return;
  const min = Math.floor(sec / 60);
  const s = sec % 60;
  timerElement.textContent = `${min.toString().padStart(2, "0")}:${s
    .toString()
    .padStart(2, "0")}`;
}

// UI & Board Rendering
function renderBoard() {
  boardElement.innerHTML = "";
  const capturePieces = [];
  for (let r = 0; r < BOARD_SIZE; r++)
    for (let c = 0; c < BOARD_SIZE; c++) {
      const p = board[r][c];
      if (
        p &&
        p.player === currentPlayer &&
        getValidMoves(r, c).some((m) => m.capture)
      )
        capturePieces.push(`${r},${c}`);
    }

  const rowIndices =
    myPlayerNumber === 2
      ? [...Array(BOARD_SIZE).keys()].reverse()
      : [...Array(BOARD_SIZE).keys()];
  const colIndices =
    myPlayerNumber === 2
      ? [...Array(BOARD_SIZE).keys()].reverse()
      : [...Array(BOARD_SIZE).keys()];

  for (const row of rowIndices) {
    for (const col of colIndices) {
      const square = document.createElement("div");
      square.classList.add("square", (row + col) % 2 === 0 ? "light" : "dark");
      square.dataset.row = row;
      square.dataset.col = col;

      if (
        selectedPiece &&
        validMoves.some((m) => m.to.row === row && m.to.col === col)
      ) {
        const move = validMoves.find(
          (m) => m.to.row === row && m.to.col === col
        );
        square.classList.add(move.capture ? "capture-highlight" : "highlight");
      }

      const piece = board[row][col];
      if (piece) {
        const pieceDiv = document.createElement("div");
        pieceDiv.classList.add(
          "piece",
          piece.player === 1 ? "player1" : "player2"
        );
        if (piece.king) {
          pieceDiv.classList.add("king");
          pieceDiv.textContent = "♔";
        }
        if (capturePieces.includes(`${row},${col}`))
          pieceDiv.classList.add("capture-glow");
        square.appendChild(pieceDiv);
      }

      square.style.cursor = boardEnabled ? "pointer" : "not-allowed";
      square.onclick = boardEnabled ? () => onSquareClick(row, col) : null;

      boardElement.appendChild(square);
    }
  }

  turnIndicator.textContent = `Turn: ${getPlayerName(currentPlayer)}`;
  document
    .getElementById("you-pill")
    .classList.toggle("active", myPlayerNumber === currentPlayer);
  document
    .getElementById("opp-pill")
    .classList.toggle("active", myPlayerNumber !== currentPlayer);
}

function onSquareClick(row, col) {
  if (!boardEnabled) {
    messageElement.textContent = "Game is not active.";
    return;
  }
  if (currentPlayer !== myPlayerNumber) {
    messageElement.textContent = "It's not your turn.";
    return;
  }

  const piece = board[row][col];

  if (selectedPiece) {
    const move = validMoves.find((m) => m.to.row === row && m.to.col === col);
    if (!move) {
      selectedPiece = null;
      validMoves = [];
      messageElement.textContent = "";
      renderBoard();
      return;
    }

    // Apply move locally
    makeMove(move);

    if (move.capture && hasFurtherCapture(move.to.row, move.to.col)) {
      selectedPiece = { row: move.to.row, col: move.to.col };
      validMoves = getValidMoves(selectedPiece.row, selectedPiece.col).filter(
        (m) => m.capture
      );
      messageElement.textContent = "Multi-capture! Make another capture.";
      boardEnabled = true;
      renderBoard();
      socket.emit("make-move", move);
      return;
    } else {
      selectedPiece = null;
      validMoves = [];
      currentPlayer = currentPlayer === 1 ? 2 : 1;
      boardEnabled = myPlayerNumber === currentPlayer;

      if (
        !playerHasPieces(currentPlayer === 1 ? 2 : 1) ||
        !playerHasAnyValidMoves(currentPlayer === 1 ? 2 : 1)
      ) {
        boardEnabled = false;
      } else {
        messageElement.textContent = `Move made. ${getPlayerName(
          currentPlayer
        )}'s turn.`;
      }

      renderBoard();
      socket.emit("make-move", move);
    }
  } else {
    if (piece && piece.player === myPlayerNumber) {
      if (playerHasCaptureMoves()) {
        const caps = getValidMoves(row, col).filter((m) => m.capture);
        if (caps.length) {
          selectedPiece = { row, col };
          validMoves = caps;
          messageElement.textContent = "Select a capture move.";
        } else {
          messageElement.textContent = "You must capture if possible.";
          selectedPiece = null;
          validMoves = [];
        }
      } else {
        validMoves = getValidMoves(row, col);
        if (validMoves.length === 0) {
          messageElement.textContent = "No valid moves for this piece.";
          selectedPiece = null;
          validMoves = [];
        } else {
          selectedPiece = { row, col };
          messageElement.textContent = "Select a move.";
        }
      }
      renderBoard();
    }
  }
}

function updateTurnUI(isYourTurn) {
  turnIndicator.textContent = isYourTurn ? "Turn: You" : "Turn: Opponent";
  messageElement.textContent = isYourTurn
    ? "It's your turn."
    : "Waiting for opponent's move...";
  document.getElementById("you-pill").classList.toggle("active", isYourTurn);
  document.getElementById("opp-pill").classList.toggle("active", !isYourTurn);
}

// Overlay helpers
function showGameResult(message) {
  const overlay = document.getElementById("game-result-overlay");
  const messageDiv = document.getElementById("game-result-message");
  messageDiv.textContent = message;
  overlay.style.display = "flex";
  boardEnabled = false;
}
//sounds
function playGameStartSound() {
  const startSound = new Audio("/sounds/game-start.mp3");
  startSound.volume = 0.5;
  startSound.play().catch(err => console.error("Sound play failed:", err));
}

function playMoveSound() {
  const moveSound = new Audio("/sounds/move.wav");
  moveSound.volume = 0.5; // optional, 0.0 - 1.0
  moveSound.play().catch(err => console.error("Sound play failed:", err));
}

function playCaptureSound() {
  const captureSound = new Audio("/sounds/capture.wav");
  captureSound.volume = 0.5;
  captureSound.play().catch(err => console.error("Capture sound failed:", err));
}
function playGameOverSound() {
  const gameOverSound = new Audio("/sounds/game-over.mp3"); // make sure file exists
  gameOverSound.volume = 0.5;
  gameOverSound.play().catch(err => console.error("Sound play failed:", err));
}

//winner

function showWaitingOverlay() {
  const overlay = document.getElementById("waiting-overlay");
  const messageEl = document.getElementById("waiting-message");
  if (!overlay || !messageEl) return;

  messageEl.textContent = "Waiting for opponent to join... (up to 5 minutes)";
  overlay.style.display = "flex";
}

function hideWaitingOverlay() {
  const overlay = document.getElementById("waiting-overlay");
  if (overlay) overlay.style.display = "none";
}




// === SOCKET.IO EVENTS ===
socket.on("connect", () => {
  messageElement.textContent = "Connected to server.";
});
// Opponent not joined yet
socket.on("room-waiting", () => {
  boardEnabled = false;
  renderBoard();
  displayTimer(null);

  // Show dynamic waiting overlay
  showWaitingOverlay();

  console.log("[Socket] Waiting for opponent to join...");
});

// Game is ready to start
socket.on("room-ready", (data) => {
  myPlayerNumber = data.playerNumber;
  board = data.board;
  currentPlayer = data.currentPlayer;
  boardEnabled = myPlayerNumber === currentPlayer;

  // Hide waiting overlay
  hideWaitingOverlay();

  messageElement.textContent = `Game started! You are Player ${myPlayerNumber}.`;
  updateTurnUI(boardEnabled);

  renderBoard();
  playGameStartSound();
  displayTimer(data.timer ?? null);

  console.log(`[Socket] Game started for Player ${myPlayerNumber}`);
});

socket.on("timer-update", (data) =>
  displayTimer(data.timeLeftSeconds ?? data.timeLeft ?? null)
);

socket.on("timer-expired", () => {
  boardEnabled = false;
  messageElement.textContent = "Time's up! Game over.";
  displayTimer(0);
  renderBoard();
});

socket.on("move-made", (data) => {
  board = data.board;
  currentPlayer = data.currentPlayer;
  boardEnabled = myPlayerNumber === currentPlayer;

  // Play capture sound if the move included a capture
  if (data.move.capture) {
    playCaptureSound();
  } else {
    // Otherwise play regular move sound
    playMoveSound();
  }

  // Handle multi-capture scenario
  if (data.multiCapture && boardEnabled) {
    messageElement.textContent = "Multi-capture! Make another capture.";
    selectedPiece = data.move.to;
    validMoves = getValidMoves(selectedPiece.row, selectedPiece.col).filter(
      (m) => m.capture
    );
  } else {
    selectedPiece = null;
    validMoves = [];
  }

  // Update UI
  updateTurnUI(boardEnabled);
  renderBoard();

  // Update timer if sent
  if (data.timeLeftSeconds !== undefined) {
    displayTimer(data.timeLeftSeconds);
  }
});

socket.on("opponent-disconnected", () => {
  boardEnabled = false;
  messageElement.textContent = "Opponent disconnected. Game paused.";
  displayTimer(null);
  renderBoard();
});

socket.on("opponent-reconnected", () => {
  messageElement.textContent = "Opponent reconnected. Game resumed.";
  boardEnabled = myPlayerNumber === currentPlayer;
  updateTurnUI(boardEnabled);
  renderBoard();
});

socket.on("connect_error", (err) => {
  messageElement.textContent = `Connection error: ${err.message}`;
  boardEnabled = false;
  displayTimer(null);
});

socket.on("disconnect", () => {
  boardEnabled = false;
  messageElement.textContent = "Disconnected from server.";
  displayTimer(null);
});
socket.on("game-over", (data) => {
  boardEnabled = false;
  displayTimer(0);
  renderBoard();
   playGameOverSound();


  // Fallback
  showGameResult(data.message || "Game over.");
});


function updateTurnTimerDisplay(sec) {
  if (sec === null || sec === undefined) return;
  const min = Math.floor(sec / 60);
  const s = sec % 60;
  document.getElementById("turn-timer").textContent =
    `${min.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

// Server sends updates every second or whenever needed
socket.on("turn-timer-update", (data) => {
  // data.timeLeft is in seconds
  updateTurnTimerDisplay(data.timeLeft);
});

// Optional: handle turn expiration
socket.on("turn-timeout", (data) => {
  boardEnabled = false;
  messageElement.textContent = "Turn time expired!";
  renderBoard();
});

socket.on("turn-swapped", (data) => {
  // Update current player
  currentPlayer = data.currentPlayer;

  // Enable or disable the board for this client
  boardEnabled = data.yourTurn;

  // Clear any selected piece
  selectedPiece = null;
  validMoves = [];

  // Update turn indicator and message
  updateTurnUI(boardEnabled);

  // Re-render board
  renderBoard();

  // Optional: play sound for turn swap
  if (boardEnabled) {
    messageElement.textContent = "Your turn! Make a move.";
  } else {
    messageElement.textContent = "Opponent's turn. Please wait...";
  }
});
