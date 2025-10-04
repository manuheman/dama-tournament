const BOARD_SIZE = 8;
const boardElement = document.getElementById("board");
const turnIndicator = document.getElementById("turn-indicator");
const restartBtn = document.getElementById("restartBtn");

let board = [];
let selectedPiece = null;
let validMoves = [];
let myColor = null;        // 'red' or 'green'
let myPlayerId = null;
let currentTurn = null;
let boardEnabled = false;

// -----------------
// Waiting message
// -----------------
const waitingMessage = document.createElement('div');
waitingMessage.id = 'waitingMessage';
waitingMessage.textContent = 'Waiting for opponent...';
waitingMessage.style.fontSize = '20px';
waitingMessage.style.textAlign = 'center';
waitingMessage.style.padding = '20px';
boardElement.appendChild(waitingMessage);

// -----------------
// Socket.IO setup
// -----------------
const socket = io('/dama');
const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('roomId');
myPlayerId = urlParams.get('userId');

// Join the room


// -----------------
// Start game
// -----------------
function startGame() {
  boardEnabled = true;
  boardElement.innerHTML = '';
  initBoard();
  updateTurnIndicator();
}

// -----------------
// Update turn indicator
// -----------------
function updateTurnIndicator() {
  if (!currentTurn) {
    turnIndicator.textContent = 'Waiting for opponent...';
    return;
  }

  if (currentTurn === myPlayerId) {
    turnIndicator.textContent = `Your Turn (${myColor})`;
  } else {
    const oppColor = myColor === 'red' ? 'green' : 'red';
    turnIndicator.textContent = `Opponent's Turn (${oppColor})`;
  }
}

// -----------------
// Initialize board
// -----------------
function initBoard() {
  board = [];
  boardElement.innerHTML = '';

  for (let row = 0; row < BOARD_SIZE; row++) {
    board[row] = [];
    for (let col = 0; col < BOARD_SIZE; col++) {
      const square = document.createElement('div');
      square.classList.add('square', (row + col) % 2 === 0 ? 'light' : 'dark');
      square.dataset.row = row;
      square.dataset.col = col;

      // Place pieces only on dark squares
      if ((row + col) % 2 !== 0 && row < 3) {
        const piece = createPiece('green', 2); // top = green
        square.appendChild(piece.element);
        board[row][col] = piece;
      } else if ((row + col) % 2 !== 0 && row > 4) {
        const piece = createPiece('red', 1); // bottom = red
        square.appendChild(piece.element);
        board[row][col] = piece;
      } else {
        board[row][col] = null;
      }

      square.addEventListener('click', () => handleClick(row, col));
      boardElement.appendChild(square);
    }
  }

  selectedPiece = null;
  validMoves = [];
}

// -----------------
// Create piece object
// -----------------
// -----------------
function createPiece(color, player, isKing = false) {
  const element = document.createElement('div');
  element.classList.add('piece', color);
  element.style.width = '80%';
  element.style.height = '80%';
  element.style.borderRadius = '50%';
  element.style.backgroundColor = color;
  element.style.margin = 'auto';
  element.style.position = 'relative';
  element.style.top = '10%';
  element.style.left = '0';
  
  const piece = { color, player, king: isKing, element };

  // If the piece is a king, show crown emoji
  if (isKing) {
    element.textContent = '👑';
    element.style.fontSize = '1.8em';
    element.style.fontWeight = 'bold';
    element.style.color = 'gold';
    element.style.display = 'flex';
    element.style.justifyContent = 'center';
    element.style.alignItems = 'center';
    element.style.lineHeight = '50px';
  }

  return piece;
}

// -----------------
// Handle click
// -----------------
function handleClick(row, col) {
  if (!boardEnabled || currentTurn !== myPlayerId) return;

  const squareData = board[row][col];

  // -----------------
  // Determine if any capture is mandatory
  // -----------------
  const mandatoryCaptures = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const piece = board[r][c];
      if (piece && piece.color === myColor) {
        const caps = getValidMoves(r, c, true); // only capture moves
        if (caps.length > 0) mandatoryCaptures.push({ row: r, col: c, moves: caps });
      }
    }
  }

  // -----------------
  // Select piece
  // -----------------
  if (squareData && squareData.color === myColor) {
    clearHighlights();
    selectedPiece = { row, col };

    // If any capture exists, restrict selection to capturing pieces
    if (mandatoryCaptures.length > 0) {
      const isCapturingPiece = mandatoryCaptures.some(p => p.row === row && p.col === col);
      if (!isCapturingPiece) {
        selectedPiece = null;
        return; // cannot select non-capturing piece
      }
      validMoves = getValidMoves(row, col, true); // only capture moves
    } else {
      validMoves = getValidMoves(row, col); // normal moves allowed
    }

    highlightValidMoves();
    getSquare(row, col).classList.add('selected');
    return;
  }

  // -----------------
  // Move piece
  // -----------------
  if (selectedPiece) {
    // Find the move in validMoves
    const move = validMoves.find(m => m.to.row === row && m.to.col === col);
    if (!move) return;

    makeMove(move);

    // Send move to server
    socket.emit('playerMove', {
      roomId,
      playerId: myPlayerId,
      fromRow: move.from.row,
      fromCol: move.from.col,
      toRow: move.to.row,
      toCol: move.to.col,
      captured: move.capture ? [move.capture.row, move.capture.col] : null
    });

    // -----------------
    // Multi-jump for captures
    // -----------------
    if (move.capture) {
      selectedPiece = { row: move.to.row, col: move.to.col };
      validMoves = getValidMoves(selectedPiece.row, selectedPiece.col, true).filter(m => m.capture);

      if (validMoves.length > 0) {
        clearHighlights();
        highlightValidMoves();
        getSquare(selectedPiece.row, selectedPiece.col).classList.add('selected');
        return; // player continues turn
      }
    }

    // -----------------
    // End turn
    // -----------------
    selectedPiece = null;
    validMoves = [];
    currentTurn = null;
    clearHighlights();
    updateTurnIndicator();
  }
}

// -----------------
// Make move
// -----------------
function makeMove({ from, to, capture }) {
  const piece = board[from.row][from.col];
  if (!piece) return;

  // Update board state
  board[to.row][to.col] = piece;
  board[from.row][from.col] = null;

  // Move DOM element smoothly
  const fromSquare = getSquare(from.row, from.col);
  const toSquare = getSquare(to.row, to.col);

  if (piece.element.parentNode !== toSquare) {
    toSquare.appendChild(piece.element);
  }

  // Remove captured piece visually and from board
  if (capture) {
    const capturedPiece = board[capture.row][capture.col];
    if (capturedPiece) {
      board[capture.row][capture.col] = null;
      const captureSquare = getSquare(capture.row, capture.col);
      if (captureSquare) captureSquare.innerHTML = '';
    }
  }

  // King promotion with visual feedback
  if (!piece.king) {
    const promoteRow = piece.player === 1 ? 0 : BOARD_SIZE - 1;
    if (to.row === promoteRow) {
      piece.king = true;
      piece.element.style.border = '2px solid gold';
      piece.element.style.boxShadow = '0 0 10px gold';
      piece.element.style.transition = 'transform 0.3s ease, box-shadow 0.3s ease';
      piece.element.style.transform = 'scale(1.2)';
      setTimeout(() => {
        piece.element.style.transform = 'scale(1)';
      }, 300);
    }
  }
}

// -----------------
// Get valid moves
// -----------------

function getMandatoryCaptures(playerId) {
  const mandatoryMoves = [];

  // Helper to check if a position is within board boundaries
  const inBounds = (r, c) => r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;

  // Loop through the board
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const piece = board[row][col];
      if (!piece || piece.player !== (myColor === 'red' ? 1 : 2)) continue;

      const captureDirections = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

      captureDirections.forEach(([dx, dy]) => {
        const midRow = row + dx;
        const midCol = col + dy;
        const capRow = row + 2 * dx;
        const capCol = col + 2 * dy;

        if (
          inBounds(midRow, midCol) &&
          inBounds(capRow, capCol) &&
          board[midRow][midCol] &&
          board[midRow][midCol].color !== piece.color &&
          !board[capRow][capCol]
        ) {
          mandatoryMoves.push({
            from: { row, col },
            to: { row: capRow, col: capCol },
            capture: { row: midRow, col: midCol }
          });
        }

        // King multi-step capture (slide then capture)
        if (piece.king) {
          let rr = row + dx;
          let cc = col + dy;
          while (inBounds(rr, cc) && !board[rr][cc]) {
            rr += dx;
            cc += dy;
          }
          if (inBounds(rr, cc) && board[rr][cc] && board[rr][cc].color !== piece.color) {
            let rrr = rr + dx;
            let ccc = cc + dy;
            while (inBounds(rrr, ccc) && !board[rrr][ccc]) {
              mandatoryMoves.push({
                from: { row, col },
                to: { row: rrr, col: ccc },
                capture: { row: rr, col: cc }
              });
              rrr += dx;
              ccc += dy;
            }
          }
        }
      });
    }
  }

  return mandatoryMoves;
}

// -----------------
// Get valid moves
// -----------------
function getValidMoves(row, col, mustCaptureOnly = false) {
  const moves = [];
  const piece = board?.[row]?.[col];
  if (!piece) return moves;

  const inBounds = (r, c) => r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;

  const normalDirections = piece.king
    ? [[-1, -1], [-1, 1], [1, -1], [1, 1]] // king: all directions
    : piece.player === 1
      ? [[-1, -1], [-1, 1]] // red men: forward only
      : [[1, -1], [1, 1]];  // green men: forward only

  const captureDirections = [[-1, -1], [-1, 1], [1, -1], [1, 1]]; // captures: all directions

  const normalMoves = [];
  const captureMoves = [];

  // -----------------
  // Normal moves (only if not restricted to capture)
  // -----------------
  if (!mustCaptureOnly && !piece.king) {
    normalDirections.forEach(([dx, dy]) => {
      const r = row + dx;
      const c = col + dy;
      if (inBounds(r, c) && !board[r][c]) {
        normalMoves.push({
          from: { row, col },
          to: { row: r, col: c },
          capture: null
        });
      }
    });
  }

  // King slide (non-capture moves)
  if (!mustCaptureOnly && piece.king) {
    normalDirections.forEach(([dx, dy]) => {
      let r = row + dx;
      let c = col + dy;
      while (inBounds(r, c) && !board[r][c]) {
        normalMoves.push({
          from: { row, col },
          to: { row: r, col: c },
          capture: null
        });
        r += dx;
        c += dy;
      }
    });
  }

  // -----------------
  // Capture moves
  // -----------------
  captureDirections.forEach(([dx, dy]) => {
    const midRow = row + dx;
    const midCol = col + dy;
    const capRow = row + 2 * dx;
    const capCol = col + 2 * dy;

    // Men: 1-step captures
    if (
      inBounds(midRow, midCol) &&
      inBounds(capRow, capCol) &&
      board[midRow][midCol] &&
      board[midRow][midCol].color !== piece.color &&
      !board[capRow][capCol]
    ) {
      captureMoves.push({
        from: { row, col },
        to: { row: capRow, col: capCol },
        capture: { row: midRow, col: midCol }
      });
    }

    // Kings: sliding captures
    if (piece.king) {
      let r = row + dx;
      let c = col + dy;

      // slide until hitting a piece
      while (inBounds(r, c) && !board[r][c]) {
        r += dx;
        c += dy;
      }

      if (inBounds(r, c) && board[r][c] && board[r][c].color !== piece.color) {
        let jumpR = r + dx;
        let jumpC = c + dy;

        while (inBounds(jumpR, jumpC) && !board[jumpR][jumpC]) {
          captureMoves.push({
            from: { row, col },
            to: { row: jumpR, col: jumpC },
            capture: { row: r, col: c }
          });
          jumpR += dx;
          jumpC += dy;
        }
      }
    }
  });

  // -----------------
  // Forced capture rule
  // -----------------
  return captureMoves.length > 0 ? captureMoves : normalMoves;
}

// -----------------
// Highlight valid moves
// -----------------
// -----------------
// Highlight valid moves for a selected piece
// -----------------
function highlightValidMoves() {
  if (!validMoves || validMoves.length === 0) return;

  validMoves.forEach(({ to, capture }) => {
    const toSquare = getSquare(to.row, to.col);
    if (toSquare) toSquare.classList.add('highlight');

    // Highlight captured piece square differently
    if (capture) {
      const capSquare = getSquare(capture.row, capture.col);
      if (capSquare) capSquare.classList.add('capture-highlight');
    }
  });

  // Highlight the selected piece
  if (selectedPiece) {
    const selSquare = getSquare(selectedPiece.row, selectedPiece.col);
    if (selSquare) selSquare.classList.add('selected');
  }
}

// -----------------
// Clear all highlights from the board
// -----------------
function clearHighlights() {
  Array.from(boardElement.children).forEach(square => {
    if (square.classList) {
      square.classList.remove(
        'highlight',          // normal move
        'selected',           // selected piece
        'capture-highlight',  // capture square
        'selectable'          // piece that can move
      );
    }
  });
}

// -----------------
// Highlight all pieces that have mandatory captures
// -----------------
function highlightMandatoryCaptures() {
  const mandatory = getMandatoryCaptures(); // returns [{ row, col }, ...]

  mandatory.forEach(({ row, col }) => {
    const square = getSquare(row, col);
    if (square) square.classList.add('capture-highlight');
  });
}

// -----------------
// Helper: highlight all selectable pieces for the current player
// -----------------
function highlightSelectablePieces() {
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const piece = board[row][col];
      if (piece && piece.color === myColor) {
        const moves = getValidMoves(row, col);
        if (moves.length > 0) {
          const square = getSquare(row, col);
          if (square) square.classList.add('selectable');
        }
      }
    }
  }
}



function showWinnerOverlay(winnerId) {
  let overlay = document.getElementById('winnerOverlay');

  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'winnerOverlay';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.backgroundColor = 'rgba(0,0,0,0.8)';
    overlay.style.display = 'flex';
    overlay.style.flexDirection = 'column';
    overlay.style.justifyContent = 'center';
    overlay.style.alignItems = 'center';
    overlay.style.zIndex = '9999';
    overlay.style.opacity = '0';
    overlay.style.transition = 'opacity 0.5s ease';

    // Winner message
    const message = document.createElement('div');
    message.id = 'winnerMessage';
    message.style.backgroundColor = '#fff';
    message.style.padding = '40px 60px';
    message.style.borderRadius = '20px';
    message.style.textAlign = 'center';
    message.style.fontSize = '28px';
    message.style.fontWeight = '700';
    message.style.boxShadow = '0 8px 25px rgba(0,0,0,0.5)';
    message.style.transform = 'scale(0.5)';
    message.style.transition = 'transform 0.6s cubic-bezier(0.68, -0.55, 0.265, 1.55)'; // bounce
    message.style.color = '#333';
    overlay.appendChild(message);

    // Dashboard button
    const dashboardBtn = document.createElement('button');
    dashboardBtn.textContent = 'Return to Dashboard';
    dashboardBtn.style.marginTop = '25px';
    dashboardBtn.style.padding = '15px 30px';
    dashboardBtn.style.fontSize = '20px';
    dashboardBtn.style.cursor = 'pointer';
    dashboardBtn.style.border = 'none';
    dashboardBtn.style.borderRadius = '12px';
    dashboardBtn.style.background = 'linear-gradient(135deg, #4CAF50, #2E8B57)';
    dashboardBtn.style.color = 'white';
    dashboardBtn.style.fontWeight = '600';
    dashboardBtn.style.boxShadow = '0 5px 15px rgba(0,0,0,0.3)';
    dashboardBtn.style.transition = 'transform 0.2s, box-shadow 0.2s';
    dashboardBtn.addEventListener('mouseover', () => {
      dashboardBtn.style.transform = 'scale(1.05)';
      dashboardBtn.style.boxShadow = '0 8px 20px rgba(0,0,0,0.4)';
    });
    dashboardBtn.addEventListener('mouseout', () => {
      dashboardBtn.style.transform = 'scale(1)';
      dashboardBtn.style.boxShadow = '0 5px 15px rgba(0,0,0,0.3)';
    });
    dashboardBtn.addEventListener('click', () => {
      // Redirect to dashboard with userId
      window.location.href = `dashboard.html?userId=${myPlayerId}`;
    });
    overlay.appendChild(dashboardBtn);

    document.body.appendChild(overlay);

    // Fade-in overlay
    requestAnimationFrame(() => {
      overlay.style.opacity = '1';
      message.style.transform = 'scale(1)';
    });
  }

  // Set winner message dynamically
  const message = document.getElementById('winnerMessage');
  if (winnerId === myPlayerId) {
    message.textContent = `🎉 You Win! 🏆`;
    message.style.color = '#4CAF50';
  } else {
    message.textContent = `😞 You Lose! Opponent Wins 🏆`;
    message.style.color = '#FF3B30';
  }

  overlay.style.display = 'flex';
}


// Helper to get the opponent's playerId
function getOpponentId() {
  const squares = Object.keys(board).map(Number);
  return squares.find(id => id !== myPlayerId);
}


function renderBoard() {
  boardElement.innerHTML = '';
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const cell = board[r][c];
      const cellElement = document.createElement('div');
      cellElement.classList.add('cell');
      if ((r + c) % 2 === 0) cellElement.classList.add('light');
      else cellElement.classList.add('dark');

      if (cell?.element) cellElement.appendChild(cell.element);
      cellElement.dataset.row = r;
      cellElement.dataset.col = c;

      boardElement.appendChild(cellElement);
    }
  }
}




// -----------------
// Get square
// -----------------
function getSquare(row, col) {
  return boardElement.children[row * BOARD_SIZE + col];
}

// -----------------
// Restart
// -----------------
restartBtn.addEventListener('click', () => {
  if (!boardEnabled) return;
  initBoard();
  updateTurnIndicator();
});



socket.emit('joinGameRoom', { roomId, playerId: myPlayerId });

// -----------------
// Listen for game state updates
// -----------------
// -----------------
// Listen for game state updates
// -----------------
socket.on('gameState', (game) => {
  console.log('📡 Received gameState from server:', game);

  // ----------------------------
  // Set player's color from server
  // ----------------------------
  myColor = game.colors[myPlayerId] || null;

  // ----------------------------
  // Flip board for Player 2 (green)
  // ----------------------------
  if (myColor === 'green') {
    boardElement.classList.add('board-flipped');
  } else {
    boardElement.classList.remove('board-flipped');
  }

  // ----------------------------
  // Always use server's currentTurn
  // ----------------------------
  currentTurn = game.currentTurn;

  // Enable board only if it's player's turn and game has started
  boardEnabled = game.status === 'started' && currentTurn === myPlayerId;

  // ----------------------------
  // Check winner before rendering board
  // ----------------------------
  if (game.status === 'finished' && game.winner) {
    console.log(`🏆 Winner detected in gameState: ${game.winner}`);
    showWinnerOverlay(game.winner);
    boardEnabled = false; // disable moves
    return; // stop rendering board; balance comes via 'gameOver'
  }

  // ----------------------------
  // Clear old board
  // ----------------------------
  boardElement.innerHTML = '';

  // Show waiting message if game not started
  if (game.status === 'waiting') {
    console.log('⏳ Waiting for opponent...');
    boardEnabled = false;
    boardElement.appendChild(waitingMessage);
    turnIndicator.textContent = 'Waiting for opponent...';
    return;
  }

  // ----------------------------
  // Render the board
  // ----------------------------
  board = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));

  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const squareData = game.board[row][col];
      const square = document.createElement('div');
      square.classList.add('square', (row + col) % 2 === 0 ? 'light' : 'dark');
      square.dataset.row = row;
      square.dataset.col = col;

      if (squareData) {
        const piece = createPiece(squareData.color, squareData.player);
        piece.king = squareData.king || false;
        if (piece.king) piece.element.style.border = '2px solid gold';
        piece.element.style.transform = myColor === 'green' ? 'rotate(180deg)' : 'rotate(0deg)';

        square.appendChild(piece.element);
        board[row][col] = piece;
      }

      square.addEventListener('click', () => handleClick(row, col));
      boardElement.appendChild(square);
    }
  }

  // ----------------------------
  // Highlight & UI updates
  // ----------------------------
  clearHighlights();
  updateTurnIndicator();

  // ----------------------------
  // Enforce mandatory captures
  // ----------------------------
  let mandatoryCaptures = [];
  if (boardEnabled) {
    mandatoryCaptures = getMandatoryCaptures(myPlayerId);

    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const piece = board[r][c];
        if (!piece || piece.color !== myColor) continue;

        const moves = getValidMoves(r, c);

        // If captures exist, only mark those as selectable
        const selectableMoves = mandatoryCaptures.length > 0
          ? moves.filter(m => m.capture)
          : moves;

        if (selectableMoves.length > 0) {
          getSquare(r, c).classList.add('selectable');
        }
      }
    }
  }

  console.log('🖼️ Board rendered and highlights updated.');
});

// ----------------------------
// Handle game over separately
// ----------------------------
socket.on('gameOver', ({ winnerId, message, winningAmount, newBalance }) => {
  console.log(`🏆 Game over: ${message}`);
  showWinnerOverlay(winnerId);

  // Update UI balance
  const balanceDisplay = document.getElementById('balanceDisplay');
  if (balanceDisplay) {
    balanceDisplay.textContent = `Balance: ${newBalance.toFixed(2)} birr`;
  }

  boardEnabled = false; // disable moves
});




// -----------------
// Listen for any move (self or opponent)
// -----------------
socket.on('playerMoveBroadcast', ({ playerId, fromRow, fromCol, toRow, toCol, captured }) => {
  // Ignore move if it's already applied locally
  if (playerId !== myPlayerId) {
    makeMove({
      from: { row: fromRow, col: fromCol },
      to: { row: toRow, col: toCol },
      capture: captured ? { row: captured[0], col: captured[1] } : null
    });
  }

  // Update turn
  currentTurn = (playerId === myPlayerId) ? getOpponentId() : myPlayerId;
  updateTurnIndicator();
});



// -----------------
// Listen for opponent moves
// -----------------
socket.on('opponentMove', ({ fromRow, fromCol, toRow, toCol, captured }) => {
  // Move the piece on the local board
  const piece = board[fromRow][fromCol];
  board[toRow][toCol] = piece;
  board[fromRow][fromCol] = null;

  // Remove captured piece if any
  if (captured) {
    board[captured[0]][captured[1]] = null;
  }

  // Re-render board without resetting everything
  renderBoard();

  console.log(`📦 Opponent moved: (${fromRow},${fromCol}) -> (${toRow},${toCol})`);
  if (captured) console.log(`💀 Captured piece at: (${captured[0]},${captured[1]})`);

  // ✅ Do not change currentTurn here
  // The next turn will be updated when 'gameState' is received from server
});

// -----------------
// Game Over Handler
// -----------------
 






// -----------------
// Notify server when leaving
// -----------------
window.addEventListener('beforeunload', () => {
  socket.emit('dislink', { roomId, playerId: myPlayerId });
});


 
  const stake = Number(urlParams.get('stake')) || 0;

  // Display stake
  const stakeDisplay = document.getElementById('stakeDisplay');
  stakeDisplay.textContent = `Stake: ${stake} birr`;

  // Calculate possible win (double the stake minus 10%)
  const possibleWinAmount = stake * 2 * 0.9; // 10% deduction
  const possibleWinDisplay = document.getElementById('possibleWin');
  possibleWinDisplay.textContent = `Possible Win: ${possibleWinAmount.toFixed(2)} birr`;