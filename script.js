const DOM = {
    player: document.getElementById("player"),
    gameArea: document.getElementById("game-area"),
    score: document.getElementById("score"),
    bestScore: document.getElementById("best-score"),
    lives: document.getElementById("lives"),
    timeDisplay: document.getElementById("time-display"),
    stormText: document.getElementById("stormText"),
    recordMsg: document.getElementById("recordMsg"),
    pauseBtn: document.getElementById("pause-btn"),
    restartBtn: document.getElementById("restart-ui-btn"),
    shopBtn: document.getElementById("shop-btn"),
    infoBtn: document.getElementById("info-btn"),
    gameOverModal: document.getElementById("gameOverModal"),
    rulesModal: document.getElementById("rulesModal"),
    shopModal: document.getElementById("shopModal"),
};

const GAME_CONFIG = {
    GAME_DURATION_MS: 2 * 60 * 1000, 
    DEFAULT_SPAWN_INTERVAL: 900, 
    STORM_DURATION: 8000, 
    INITIAL_BASE_SPEED: 3,
    LIVES: 3,
    MISSED_THRESHOLD: 5, 
};

let gameState = {
    score: 0,
    bestScore: Number(localStorage.getItem("bestScore")) || 0,
    lives: GAME_CONFIG.LIVES,
    baseSpeed: GAME_CONFIG.INITIAL_BASE_SPEED,
    missedCount: 0,
    lastScoreMilestone: 0,
    remainingTimeMs: GAME_CONFIG.GAME_DURATION_MS,
    paused: false,
    pausedByInfo: false,
    stormActive: false,
    stormThreshold: 20,
    originalBackground: null,
};

let intervals = {
    fallingInterval: null,
    timeBasedInterval: null,
    gameTimerId: null,
};

// Initialization
DOM.bestScore.textContent = "Best : " + gameState.bestScore;

// Restore skin from localStorage
const savedSkin = localStorage.getItem("selectedSkin");
if (savedSkin && DOM.player) {
    DOM.player.src = `panier_${savedSkin}.png`;
}



const AUDIO_ASSETS = {
    bg: "bg_music.ogg",
    catch: "sfx_catch.mp3",
    bonus: "sfx_bonus.mp3",
    gameover: "sfx_gameover.mp3",
    bomb: "sfx_bomb.mp3",
    golden: "sfx_golden.mp3",
    miss: "sfx_miss.mp3",
    storm: "sfx_storm.mp3",
};
 
const audioMap = {}; 
let audioReady = false;
let audioMuted = localStorage.getItem("muted") === "true";
let currentGameOverAudio = null;

function loadAudio() {
    try {
        Object.entries(AUDIO_ASSETS).forEach(([key, url]) => {
            const a = new Audio();
            a.src = url;
            a.preload = "auto";
            if (key === "bg") a.loop = true;
            audioMap[key] = a;
        });
        audioReady = true;
    } catch (e) {
        console.warn("Audio load failed", e);
        audioReady = false;
    }
}

function playSound(name, { volume = 1.0 } = {}) {
    try {
        if (!audioReady || audioMuted) {
            
            return;
        }

        const base = audioMap[name];
        const srcUrl = base && base.src ? base.src : AUDIO_ASSETS[name];
        if (!srcUrl) {
            console.warn('playSound: no audio source for', name);
            return;
        }

        const s = new Audio(srcUrl);
        s.preload = 'auto';
        s.volume = volume;
        const playPromise = s.play();
        if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch((err) => {
                console.warn('Audio play failed for', name, err && err.message ? err.message : err);
            });
        }
    } catch (e) {
        // ignore
    }   
}

function playMusic() {
    try {
        if (!audioReady || audioMuted) return;
        const bg = audioMap["bg"];
        if (!bg) return;
        bg.volume = 0.45;
        return bg.play().catch((err) => {
            console.warn('bg play rejected', err && err.message ? err.message : err);
            throw err;
        });
    } catch (e) {}
}

function pauseMusic() {
    try {
        const bg = audioMap["bg"];
        if (!bg) return;
        bg.pause();
    } catch (e) {}
}

function toggleMute() {
    audioMuted = !audioMuted;
    localStorage.setItem("muted", audioMuted);
    if (audioMuted) pauseMusic(); else playMusic();
}

loadAudio();

function allowMusicOnFirstGesture() {
    const once = () => {
        if (!audioMuted) playMusic();
        document.removeEventListener('click', once);
        document.removeEventListener('keydown', once);
    };
    document.addEventListener('click', once);
    document.addEventListener('keydown', once);
}
allowMusicOnFirstGesture();

// PLAYER MOVEMENT
document.addEventListener("keydown", (e) => {
    const pos = DOM.player.offsetLeft;
    if (e.key === "ArrowLeft" && pos > 0) {
        DOM.player.style.left = pos - 20 + "px";
    }
    if (e.key === "ArrowRight" && pos < 330) {
        DOM.player.style.left = pos + 20 + "px";
    }

    // Keyboard shortcuts
    if (e.key.toLowerCase() === "p") {
        DOM.pauseBtn?.click();
    } else if (e.key.toLowerCase() === "r") {
        DOM.restartBtn?.click();
    } else if (e.key.toLowerCase() === "s") {
        DOM.shopBtn?.click();
    } else if (e.key.toLowerCase() === "i") {
        document.getElementById("info-btn")?.click();
    } else if (e.key.toLowerCase() === "m") {
        try {
            toggleMute();
            const muteBtn = document.getElementById('mute-btn');
            if (muteBtn) muteBtn.textContent = audioMuted ? '🔇' : '🔈';
        } catch (err) {
            console.warn('Mute toggle failed via keyboard', err);
        }
    }
});

DOM.gameArea.addEventListener("touchmove", (e) => {
    e.preventDefault();
    if (e.touches.length > 0) {
        const touch = e.touches[0];
        const gameAreaRect = DOM.gameArea.getBoundingClientRect();
        const relativeX = touch.clientX - gameAreaRect.left;
        const playerWidth = DOM.player.offsetWidth;
        const maxLeft = gameAreaRect.width - playerWidth;
        const newLeft = Math.max(0, Math.min(maxLeft, relativeX - playerWidth / 2));
        DOM.player.style.left = newLeft + "px";
    }
});

// OBJECT SPAWNING
function createObject() {
    const obj = document.createElement("img");
    obj.classList.add("falling");

    let type;
    const r = Math.random();

    // Determine object type based on spawn probabilities
    if (gameState.stormActive) {
        // During storm: 50% pomme, 50% bomb (no bonus or golden)
        type = r < 0.5 ? "pomme" : "bomb";
    } else {
        // Normal spawn probabilities
        if (r < 0.01) {
            type = "golden"; // 1%
        } else if (r < 0.06) {
            type = "bomb"; // 5%
        } else if (r < 0.18) {
            type = "bonus"; // 12%
        } else {
            type = "pomme"; // ~82%
        }
    }

    const imageMap = {
        golden: "golden.png",
        bomb: "bombe.png",
        bonus: "bonus.png",
        pomme: "pomme.png",
    };

    obj.src = imageMap[type] || imageMap.pomme;
    obj.dataset.type = type;
    obj.style.left = Math.random() * 360 + "px";

    DOM.gameArea.appendChild(obj);
    fall(obj);
}

function fall(obj) {
    let interval = setInterval(() => {
        if (gameState.paused) return;

        const currentSpeed = gameState.baseSpeed + Math.floor(gameState.score / 10) * 0.5;
        obj.style.top = obj.offsetTop + currentSpeed + "px";

        if (checkCollision(obj)) {
            handleCatch(obj);
            clearInterval(interval);
            obj.remove();
        } else if (obj.offsetTop > 600) {
            handleMiss(obj);
            clearInterval(interval);
            obj.remove();
        }
    }, 20);

    obj._fallInterval = interval;
}

function checkCollision(obj) {
    const p = DOM.player.getBoundingClientRect();
    const o = obj.getBoundingClientRect();
    return !(p.right < o.left || p.left > o.right || p.bottom < o.top || p.top > o.bottom);
}

// HANDLE CATCH & MISS
function handleCatch(obj) {
    console.debug('handleCatch called for type=', obj && obj.dataset && obj.dataset.type);
    const messageMap = {
        golden: { text: "Golden ! +10 🎖️", points: 10 },
        bomb: { text: "Bombe ! -10 💣", points: -10 },
        bonus: { text: "Bonus ! +3 ⭐", points: 3 },
        pomme: { text: "pomme ! +1 ⚠️", points: 1 },
    };

    const handler = messageMap[obj.dataset.type] || messageMap.pomme;
    gameState.score = Math.max(0, gameState.score + handler.points);

    if (DOM.recordMsg) {
        DOM.recordMsg.textContent = handler.text;
        setTimeout(() => {
            if (DOM.recordMsg) DOM.recordMsg.textContent = "";
        }, 2000);
    }

    // Play SFX according to type
        if (obj.dataset.type === 'golden') {
            playSound('golden', { volume: 0.9 });
            showFloatingText('+10', 'floating-golden');
            pulsePlayer();
        } else if (obj.dataset.type === 'bomb') {
            playSound('bomb', { volume: 0.9 });
            try {
                showFloatingText('-10', 'floating-bomb');
                pulsePlayer(); 
                DOM.player.classList.add('player-shake');
                setTimeout(() => DOM.player.classList.remove('player-shake'), 420);
                DOM.gameArea.classList.add('bomb-hit');
                setTimeout(() => DOM.gameArea.classList.remove('bomb-hit'), 220);
            } catch (e) { console.warn('bomb visual failed', e); }
        } else if (obj.dataset.type === 'bonus') {
            playSound('bonus', { volume: 0.8 });
            try {
                const o = obj.getBoundingClientRect();
                const area = DOM.gameArea.getBoundingClientRect();
                const cx = Math.round(o.left - area.left + o.width / 2);
                const cy = Math.round(o.top - area.top + o.height / 2);
                showFloatingText('+3', 'floating-bonus', { x: cx, y: cy });
                createConfetti(cx, cy);
                pulsePlayer();
            } catch (e) {
                showFloatingText('+3', 'floating-bonus');
                pulsePlayer();
            }
    } else {
        playSound('catch', { volume: 0.7 });
        showFloatingText('+1', 'floating-pomme');
    }

    updateUI();
}

function shakePlayer(duration = 420) {
    try {
        DOM.player.classList.add('player-shake');
        setTimeout(() => DOM.player.classList.remove('player-shake'), duration);
    } catch (e) {}
}

function showFloatingText(text, cls = 'floating-bonus', coords = null) {
    try {
        console.debug('showFloatingText', text, cls, coords);
        const areaRect = DOM.gameArea.getBoundingClientRect();
        const el = document.createElement('div');
        el.className = `floating-text ${cls}`;

        let x, y;
        if (coords && typeof coords.x === 'number' && typeof coords.y === 'number') {
            x = Math.round(coords.x);
            y = Math.round(coords.y);
        } else {
            const playerRect = DOM.player.getBoundingClientRect();
            x = Math.round(playerRect.left - areaRect.left + playerRect.width / 2);
            y = Math.round(playerRect.top - areaRect.top - 10); 
        }

        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        el.textContent = text;
        DOM.gameArea.appendChild(el);
        setTimeout(() => {
            try { el.remove(); } catch (e) { console.warn('remove floating failed', e); }
        }, 950);
    } catch (e) {
        console.warn('showFloatingText failed', e);
    }
}

// Create a short confetti burst at coords (x,y) relative to game area
function createConfetti(x, y, count = 12) {
    try {
        const colors = ['#ff3b30', '#ff9500', '#ffcc00', '#4cd964', '#34aadc', '#5e5ce6'];
        const container = document.createElement('div');
        container.className = 'confetti-container';
        container.style.left = `${x}px`;
        container.style.top = `${y}px`;
        DOM.gameArea.appendChild(container);

        for (let i = 0; i < count; i++) {
            const piece = document.createElement('div');
            piece.className = 'confetti-piece';
            const color = colors[Math.floor(Math.random() * colors.length)];
            piece.style.background = color;
            // random target displacement
            const angle = Math.random() * Math.PI * 2;
            const dist = 40 + Math.random() * 60;
            const dx = Math.round(Math.cos(angle) * dist);
            const dy = Math.round(Math.sin(angle) * dist) - 10; // bias upwards
            const rot = Math.round((Math.random() - 0.5) * 720);
            piece.style.setProperty('--dx', dx + 'px');
            piece.style.setProperty('--dy', dy + 'px');
            piece.style.setProperty('--rot', rot + 'deg');
            // stagger start a little
            piece.style.animationDelay = `${Math.random() * 80}ms`;
            container.appendChild(piece);
        }

        // remove container after animation
        setTimeout(() => {
            try { container.remove(); } catch (e) { /* ignore */ }
        }, 1100);
    } catch (e) {
        console.warn('createConfetti failed', e);
    }
}

function pulsePlayer() {
    try {
        DOM.player.classList.add('player-pulse');
        setTimeout(() => DOM.player.classList.remove('player-pulse'), 420);
    } catch (e) {}
}

function handleMiss(obj) {
    // No score penalty for missing any object, including bonus
    // Only lose 1 life after 5 missed apples (pomme)

    if (obj.dataset.type === "pomme") {
        gameState.missedCount++;

        // Lose 1 life after 5 missed apples
        if (gameState.missedCount >= GAME_CONFIG.MISSED_THRESHOLD) {
            gameState.lives--;
            gameState.missedCount = 0;
            console.log(`❌ Missed ${GAME_CONFIG.MISSED_THRESHOLD} apples! Lives remaining: ${gameState.lives}`);
        }
    }

    // sound for miss 
    if (obj.dataset.type === 'pomme') {
        console.debug('handleMiss: pomme missed');
        playSound('miss', { volume: 0.35 });
        showFloatingText('Miss', 'floating-miss');
    }

    updateUI();
}

// UI UPDATES
function updateUI() {
    DOM.score.textContent = "Score : " + gameState.score;
    DOM.lives.textContent = "❤️".repeat(gameState.lives);
    DOM.bestScore.textContent = "Best : " + gameState.bestScore;

    updateTimeDisplay();

    // Check for score milestone (score-based difficulty)
    const currentMilestone = Math.floor(gameState.score / 10);
    if (currentMilestone > gameState.lastScoreMilestone) {
        gameState.lastScoreMilestone = currentMilestone;
    }

    // Trigger storm if threshold reached
    if (!gameState.stormActive && gameState.score >= gameState.stormThreshold) {
        triggerStorm();
    }

    if (gameState.lives <= 0) {
        endGame();
    }
}


function startGame() {
    gameState.score = 0;
    gameState.lives = GAME_CONFIG.LIVES;
    gameState.lastScoreMilestone = 0;
    gameState.missedCount = 0;
    gameState.baseSpeed = GAME_CONFIG.INITIAL_BASE_SPEED;
    gameState.stormThreshold = 20;
    gameState.stormActive = false;
    gameState.paused = false;

    updateUI();

    // Clear any existing intervals first
    clearInterval(intervals.fallingInterval);
    clearInterval(intervals.timeBasedInterval);
    stopGameTimer();

    // Spawn objects
    intervals.fallingInterval = setInterval(createObject, GAME_CONFIG.DEFAULT_SPAWN_INTERVAL);

    // Time-based difficulty: increase speed every 10 seconds
    intervals.timeBasedInterval = setInterval(() => {
        if (gameState.lives > 0 && !gameState.paused) {
            gameState.baseSpeed += 0.5;
            console.log(`⚡ Base speed: ${gameState.baseSpeed.toFixed(1)}`);
        }
    }, 10000);

    // Game timer
    gameState.remainingTimeMs = GAME_CONFIG.GAME_DURATION_MS;
    startGameTimer();
}

function endGame() {
    clearInterval(intervals.fallingInterval);
    clearInterval(intervals.timeBasedInterval);
    stopGameTimer();

    // Pause the game
    gameState.paused = true;

    // Stop background music and play game over SFX
    try {
        pauseMusic();
        const g = audioMap['gameover'];
        if (g && g.src) {
            try { g.currentTime = 0; } catch (e) {}
            g.volume = 0.9;
            g.play().catch(() => {});
            currentGameOverAudio = g;
        } else {
            // fallback: create temporary audio and keep reference
            try {
                const tmp = new Audio(AUDIO_ASSETS['gameover']);
                tmp.volume = 0.9;
                tmp.play().catch(() => {});
                currentGameOverAudio = tmp;
            } catch (e) {
                console.warn('Failed to play gameover SFX', e);
            }
        }
    } catch (e) {
        console.warn('Failed to play gameover SFX', e);
    }

    // Clear all falling object intervals
    document.querySelectorAll(".falling").forEach((el) => {
        if (el._fallInterval) clearInterval(el._fallInterval);
    });

    // Update modal
    document.getElementById("finalScore").textContent = "Game Over – Score : " + gameState.score;

    if (gameState.score > gameState.bestScore) {
        gameState.bestScore = gameState.score;
        localStorage.setItem("bestScore", gameState.bestScore);
        DOM.recordMsg.textContent = "Nouveau record ! 🎉";
    } else {
        DOM.recordMsg.textContent = "";
    }

    // Show shop if player scored
    const shop = document.getElementById("shop");
    if (shop) {
        shop.style.display = gameState.score > 0 ? "block" : "none";
    }

    // Show game over modal
    const modal = new bootstrap.Modal(DOM.gameOverModal, { backdrop: 'static', keyboard: false });
    modal.show();

    // Add Escape key listener for restart - works immediately
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            document.removeEventListener('keydown', escapeHandler);
            restartGame();
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    // Clean up listener when modal closes
    const cleanupListener = () => {
        document.removeEventListener('keydown', escapeHandler);
        DOM.gameOverModal.removeEventListener('hide.bs.modal', cleanupListener);
    };
    DOM.gameOverModal.addEventListener('hide.bs.modal', cleanupListener);
}

function restartGame() {
    // Hide modal
    try {
        const bsModal = bootstrap.Modal.getInstance(DOM.gameOverModal) || new bootstrap.Modal(DOM.gameOverModal);
        bsModal.hide();
    } catch (e) {
        // ignore
    }

    // Clear all intervals
    clearInterval(intervals.fallingInterval);
    clearInterval(intervals.timeBasedInterval);
    stopGameTimer();

    // If a gameover SFX is playing, stop it so background music can resume
    try {
        if (currentGameOverAudio) {
            try { currentGameOverAudio.pause(); } catch (e) {}
            try { currentGameOverAudio.currentTime = 0; } catch (e) {}
            currentGameOverAudio = null;
        }
    } catch (e) {}

    // Clear all falling objects
    document.querySelectorAll(".falling").forEach((el) => {
        if (el._fallInterval) clearInterval(el._fallInterval);
        el.remove();
    });

    // Reset state
    gameState.score = 0;
    gameState.lives = GAME_CONFIG.LIVES;
    gameState.missedCount = 0;
    gameState.lastScoreMilestone = 0;
    gameState.baseSpeed = GAME_CONFIG.INITIAL_BASE_SPEED;
    gameState.stormActive = false;
    gameState.paused = false;
    gameState.remainingTimeMs = GAME_CONFIG.GAME_DURATION_MS;

    // Restore background if changed by storm
    if (gameState.originalBackground) {
        DOM.gameArea.style.backgroundImage = gameState.originalBackground;
    }
    if (DOM.stormText) DOM.stormText.style.display = "none";
    DOM.gameArea.classList.remove("storm-active");

    // Reset pause button
    if (DOM.pauseBtn) DOM.pauseBtn.textContent = "Pause ⏸";

    // Resume background music if not muted
    try {
        if (!audioMuted) {
            const p = playMusic();
            if (p && typeof p.catch === 'function') {
                p.catch(() => {
                    // If autoplay is blocked, resume music on next user gesture
                    const once = () => {
                        try { playMusic(); } catch (e) {}
                        document.removeEventListener('click', once);
                        document.removeEventListener('keydown', once);
                    };
                    document.addEventListener('click', once);
                    document.addEventListener('keydown', once);
                });
            }
        }
    } catch (e) {}

    updateUI();
    startGame();
}

// UI BUTTON HANDLERS
if (DOM.pauseBtn) {
    DOM.pauseBtn.addEventListener("click", () => {
        gameState.paused = !gameState.paused;

        if (gameState.paused) {
            clearInterval(intervals.fallingInterval);
            clearInterval(intervals.timeBasedInterval);
            stopGameTimer();
            DOM.pauseBtn.textContent = "Reprendre ▶";
            pauseMusic();
        } else {
            // Clear any existing intervals first
            clearInterval(intervals.fallingInterval);
            clearInterval(intervals.timeBasedInterval);
            
            intervals.fallingInterval = setInterval(createObject, GAME_CONFIG.DEFAULT_SPAWN_INTERVAL);
            intervals.timeBasedInterval = setInterval(() => {
                if (gameState.lives > 0 && !gameState.paused) {
                    gameState.baseSpeed += 0.5;
                    console.log(`⚡ Base speed: ${gameState.baseSpeed.toFixed(1)}`);
                }
            }, 10000);
            startGameTimer();
            DOM.pauseBtn.textContent = "Pause ⏸";
            // resume music if not muted
            if (!audioMuted) playMusic();
        }
    });
}

if (DOM.restartBtn) {
    DOM.restartBtn.addEventListener("click", restartGame);
}

//  Info button
setTimeout(() => {
    const infoBtn = document.getElementById("info-btn");
    const rulesModal = document.getElementById("rulesModal");
    if (infoBtn && rulesModal) {
        let escapeListener = null;
        let infoModalInstance = null;

        infoBtn.addEventListener("click", () => {
            // Prevent multiple modal instances from being created
            if (infoModalInstance && infoModalInstance._isShown) {
                return;
            }
            
            // Pause the game automatically when opening info
            if (!gameState.paused) {
                gameState.paused = true;
                gameState.pausedByInfo = true;
                clearInterval(intervals.fallingInterval);
                clearInterval(intervals.timeBasedInterval);
                stopGameTimer();
                if (DOM.pauseBtn) DOM.pauseBtn.textContent = "Reprendre ▶";
            }
            
            infoModalInstance = bootstrap.Modal.getInstance(rulesModal) || new bootstrap.Modal(rulesModal);
            infoModalInstance.show();

            // Add Escape key listener to close modal
            escapeListener = (e) => {
                if (e.key === 'Escape') {
                    infoModalInstance.hide();
                }
            };
            document.addEventListener('keydown', escapeListener);
        });

        // Resume when modal is hidden
        rulesModal.addEventListener('hide.bs.modal', () => {
            if (gameState.pausedByInfo) {
                gameState.paused = false;
                gameState.pausedByInfo = false;
                intervals.fallingInterval = setInterval(createObject, GAME_CONFIG.DEFAULT_SPAWN_INTERVAL);
                intervals.timeBasedInterval = setInterval(() => {
                    if (gameState.lives > 0 && !gameState.paused) {
                        gameState.baseSpeed += 0.5;
                        console.log(`⚡ Base speed: ${gameState.baseSpeed.toFixed(1)}`);
                    }
                }, 10000);
                startGameTimer();
                if (DOM.pauseBtn) DOM.pauseBtn.textContent = "Pause ⏸";
            }
            // Remove Escape key listener
            if (escapeListener) {
                document.removeEventListener('keydown', escapeListener);
                escapeListener = null;
            }
        });

        console.log("✅ Info button listener attached");
    } else {
        console.warn("⚠️ Info button or rulesModal not found", { infoBtn, rulesModal });
    }
}, 100);

//  Shop button
setTimeout(() => {
    const shopBtn = document.getElementById("shop-btn");
    const shopModal = document.getElementById("shopModal");
    let shopModalInstance = null;
    
    if (shopBtn && shopModal) {
        shopBtn.addEventListener("click", () => {
            // Prevent multiple modal instances from being created
            if (shopModalInstance && shopModalInstance._isShown) {
                return;
            }
            
            // Pause the game when shop opens
            if (!gameState.paused) {
                gameState.paused = true;
                clearInterval(intervals.fallingInterval);
                clearInterval(intervals.timeBasedInterval);
                stopGameTimer();
                if (DOM.pauseBtn) DOM.pauseBtn.textContent = "Reprendre ▶";
                pauseMusic();
            }
            
            // Get or create modal instance
            shopModalInstance = bootstrap.Modal.getInstance(shopModal) || new bootstrap.Modal(shopModal);
            shopModalInstance.show();
        });
        
        // Resume game when shop modal closes (if it was paused by shop)
        shopModal.addEventListener('hide.bs.modal', () => {
            if (gameState.paused && !gameState.pausedByInfo && gameState.lives > 0) {
                gameState.paused = false;
                intervals.fallingInterval = setInterval(createObject, GAME_CONFIG.DEFAULT_SPAWN_INTERVAL);
                intervals.timeBasedInterval = setInterval(() => {
                    if (gameState.lives > 0 && !gameState.paused) {
                        gameState.baseSpeed += 0.5;
                    }
                }, 10000);
                startGameTimer();
                if (DOM.pauseBtn) DOM.pauseBtn.textContent = "Pause ⏸";
                if (!audioMuted) playMusic();
            }
        }, { once: false });
        
        console.log("✅ Shop button listener attached");
    } else {
        console.warn("⚠️ Shop button or shopModal not found", { shopBtn, shopModal });
    }
}, 100);

//  Mute button
setTimeout(() => {
    const muteBtn = document.getElementById('mute-btn');
    if (!muteBtn) return;
    // reflect saved state
    muteBtn.textContent = audioMuted ? '🔇' : '🔈';
    muteBtn.addEventListener('click', () => {
        toggleMute();
        muteBtn.textContent = audioMuted ? '🔇' : '🔈';
    });
    console.log('✅ Mute button listener attached');
}, 150);

// SHOP & SKINS
function setSkin(skin) {
    const path = `panier_${skin}.png`;

    const tester = new Image();
    tester.onload = () => {
        DOM.player.src = path;
        localStorage.setItem("selectedSkin", skin);
        if (DOM.recordMsg) DOM.recordMsg.textContent = "Panier changé ! ✅";
    };
    tester.onerror = () => {
        if (DOM.recordMsg) DOM.recordMsg.textContent = "Panier non disponible.";
    };
    tester.src = path;
}


// TIMER HELPERS
function formatTime(ms) {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function updateTimeDisplay() {
    if (DOM.timeDisplay) {
        DOM.timeDisplay.textContent = formatTime(gameState.remainingTimeMs);
    }
}

function startGameTimer() {
    stopGameTimer();
    updateTimeDisplay();

    intervals.gameTimerId = setInterval(() => {
        gameState.remainingTimeMs -= 1000;

        if (gameState.remainingTimeMs <= 0) {
            gameState.remainingTimeMs = 0;
            updateTimeDisplay();
            stopGameTimer();
            endGame();
            return;
        }

        updateTimeDisplay();
    }, 1000);
}

function stopGameTimer() {
    if (intervals.gameTimerId) {
        clearInterval(intervals.gameTimerId);
        intervals.gameTimerId = null;
    }
}


// STORM EVENT
function triggerStorm() {
    gameState.stormActive = true;
    console.log("🌩️ Storm triggered!");

    // Save original background
    gameState.originalBackground = DOM.gameArea.style.backgroundImage || window.getComputedStyle(DOM.gameArea).backgroundImage;

    // Apply storm visual effects
    DOM.gameArea.style.backgroundImage = 'url("storm.png")';
    if (DOM.stormText) DOM.stormText.style.display = "block";
    DOM.gameArea.classList.add("storm-active");

    // Switch metal skin to red during storm
    const savedSkin = localStorage.getItem("selectedSkin");
    if (savedSkin === "metal") {
        DOM.player.src = "panier_red.png";  
    }

    // Speed up spawning during storm
    clearInterval(intervals.fallingInterval);
    const stormSpawnInterval = Math.max(300, Math.floor(GAME_CONFIG.DEFAULT_SPAWN_INTERVAL * 0.7));
    intervals.fallingInterval = setInterval(createObject, stormSpawnInterval);

    // play storm SFX
    playSound('storm', { volume: 0.9 });

    // End storm after duration
    setTimeout(() => {
        // Restore background
        if (gameState.originalBackground) {
            DOM.gameArea.style.backgroundImage = gameState.originalBackground;
        }
        if (DOM.stormText) DOM.stormText.style.display = "none";
        DOM.gameArea.classList.remove("storm-active");

        // Restore metal skin if needed
        if (savedSkin === "metal") {
            DOM.player.src = "panier_metal.png";
        }

        // Restore normal spawn interval
        clearInterval(intervals.fallingInterval);
        intervals.fallingInterval = setInterval(createObject, GAME_CONFIG.DEFAULT_SPAWN_INTERVAL);

        gameState.stormActive = false;
        gameState.stormThreshold += 20;

        console.log("🌤️ Storm ended. Next storm at score:", gameState.stormThreshold);
    }, GAME_CONFIG.STORM_DURATION);
}

startGame();
