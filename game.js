// game2.js
(function () {
  const TILE_WIDTH = 512;
  const TILE_HEIGHT = 200;

  const LAYERS = [
    { class: 'bg-sky',   speedRatio: 0.20 }, // 雲（ゆっくり）
    { class: 'bg-hills', speedRatio: 0.50 }, // 山（中速）
  ];

  // ---- ジャンプ物理（滞空長め）----
  const GRAVITY = -200;     // px/s^2（下向き）
  const JUMP_VY = 650;       // 初速（上向き）
  const MAX_JUMP_HEIGHT = 80;

  // ---- ブースト（5秒／クール13秒）----
  const BOOST_AMOUNT = 30;
  const BOOST_DURATION_MS = 5000;
  const BOOST_COOLDOWN_MS = 13000;

  // ---- 山（上に凸の二次関数）＋ 隙間 ----
  const MOUNTAIN_HEIGHT_CHOICES = [70, 95, 120, 145, 170];
  const MOUNTAIN_GAP = 28; // 左右の透明余白＝山と山の隙間
  const MOUNTAIN_FILL = "#78c867";
  const MOUNTAIN_STROKE = "#67b759";

  // ---- 岩（障害物） ----
  const PLAYER_X = 40;          // .player の left と合わせる
  const PLAYER_W = 60;          // 当たり判定用の概算幅
  const GROUND_OFFSET = 8;      // .player の bottom と合わせる

  const ROCK_W = 34;
  const ROCK_H_CHOICES = [24, 28, 34, 40];
  const ROCK_MIN_GAP = 380;
  const ROCK_MAX_GAP = 640;
  const ROCK_SPAWN_MARGIN = 80;

  // 二次関数（上に凸）で山のSVGを作成（左右に透明余白＝隙間）
  function makeMountainSVG(w, h, heightPx, gapPx) {
    const leftX  = Math.max(0, gapPx / 2);
    const rightX = Math.min(w, w - gapPx / 2);
    const px = (leftX + rightX) / 2;
    const py = Math.max(0, h - heightPx);
    const half = (rightX - leftX) / 2;
    const a = (h - py) / (half * half); // 見た目は上に凸

    const N = 40;
    const dx = (rightX - leftX) / (N - 1);
    const pts = [];
    for (let i = 0; i < N; i++) {
      const x = leftX + i * dx;
      let y = a * (x - px) * (x - px) + py;
      y = Math.max(0, Math.min(h, y));
      pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
    const polygonPoints = `${leftX},${h} ${pts.join(" ")} ${rightX},${h}`;
    const svg =
      `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'>` +
      `<polygon points='${polygonPoints}' fill='${MOUNTAIN_FILL}' stroke='${MOUNTAIN_STROKE}' stroke-width='2' />` +
      `</svg>`;
    return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
  }

  const Game = {
    // ラン状態
    distance: 0,
    baseSpeed: 90,
    speed: 90,
    lastTimestamp: null,
    isRunning: false,

    // ブースト
    boostActive: false,
    boostEndTime: 0,
    cooldownEndTime: 0,

    // DOM
    gameBoard: null,
    layers: [], // { el, speedRatio, offset }
    playerEl: null,

    // ジャンプ
    playerY: 0,
    playerVY: 0,
    onGround: true,

    // 障害物（岩）
    rocks: [],                // [{x, h, el, hit}]
    nextRockAt: 600,          // 次の岩を出す距離
    hitCount: 0,              // 3でゲームオーバー

    // UI
    chatHistory: null,
    promptInput: null,
    sendBtn: null,
    distanceDisplay: null,
    speedDisplay: null,

    // 最高記録（タブを閉じるまで保持）
    bestDistance: 0,             // 実数(px)
    bestAtRunStart: 0,
    bestAnnouncedThisRun: false,

    init() {
      this.cacheDom();
      this.bindEvents();
      this.buildLayers();

      // sessionStorage から最高記録をロード
      const saved = sessionStorage.getItem('miniGameBestPx');
      this.bestDistance = saved ? parseFloat(saved) : 0;
      this.bestAtRunStart = this.bestDistance;
      this.bestAnnouncedThisRun = false;

      this.updateInfo();

      // キャラ
      this.playerEl = document.createElement('img');
      this.playerEl.src = './logo_omeme_kaizoudo.png';
      this.playerEl.alt = 'player';
      this.playerEl.className = 'player';
      this.gameBoard.appendChild(this.playerEl);
      this.applyPlayerTransform();

      window.addEventListener('resize', () => this.buildLayers());
    },

    cacheDom() {
      this.gameBoard = document.getElementById('game-board');

      // ゲーム用チャット
      this.chatHistory   = document.getElementById('game-chat-history');
      this.promptInput   = document.getElementById('game-prompt-input');
      this.sendBtn       = document.getElementById('game-send-btn');

      // 情報表示
      this.distanceDisplay = document.getElementById('distance');
      this.speedDisplay    = document.getElementById('speed');
    },

    bindEvents() {
      this.sendBtn?.addEventListener('click', () => {
        const msg = (this.promptInput.value || '').trim();
        if (!msg) return;
        this.addChatMessage(msg, 'user');
        this.handleCommand(msg);
        this.promptInput.value = '';
      });
      this.promptInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.sendBtn.click();
      });
    },

    addChatMessage(text, type = 'system') {
      if (!this.chatHistory) return;
      const p = document.createElement('p');
      p.textContent = text;
      p.className = (type === 'user') ? 'user-message' : 'system-message';
      this.chatHistory.appendChild(p);
      this.chatHistory.scrollTop = this.chatHistory.scrollHeight;
    },

    handleCommand(msg) {
      if (msg === 'すたーと') {
        this.restart();                   // ← 開始は「すたーと」だけ
      } else if (msg === 'がんばれ') {
        this.tryBoost();                  // 非稼働なら開始しない
      } else if (msg === 'じゃんぷ') {
        this.jump();                      // 非稼働なら開始しない
      }
    },

    startLoop() {
      if (!this.isRunning) {
        this.isRunning = true;
        this.lastTimestamp = performance.now();
        requestAnimationFrame(this.loop.bind(this));
      }
    },

    restart() {
      // 背景・障害物・状態を初期化
      this.clearRocks();
      this.hitCount = 0;
      this.layers.forEach(l => { l.offset = 0; l.el.style.transform = 'translateX(0px)'; });

      this.distance = 0;
      this.baseSpeed = 90;
      this.speed = 90;
      this.playerY = 0;
      this.playerVY = 0;
      this.onGround = true;

      this.boostActive = false;
      this.boostEndTime = 0;
      this.cooldownEndTime = 0;

      this.nextRockAt = 600;

      // 最高記録を最新ロード＆アナウンスリセット
      const saved = sessionStorage.getItem('miniGameBestPx');
      this.bestDistance = saved ? parseFloat(saved) : this.bestDistance || 0;
      this.bestAtRunStart = this.bestDistance;
      this.bestAnnouncedThisRun = false;

      this.addChatMessage('レース開始！ 障害物に3回当たるとリセットされます。', 'system');
      this.applyPlayerTransform();
      this.updateInfo();
      this.startLoop();
    },

    // ---- ブースト（非稼働時は開始しない）----
    tryBoost() {
      if (!this.isRunning) {
        this.addChatMessage('まず「すたーと」で開始してね。', 'system');
        return;
      }
      const now = performance.now();
      if (now < this.cooldownEndTime) {
        const remain = Math.ceil((this.cooldownEndTime - now) / 1000);
        this.addChatMessage(`クールタイム中… 残り ${remain} 秒`, 'system');
        return;
      }
      this.boostActive = true;
      this.boostEndTime = now + BOOST_DURATION_MS;
      this.cooldownEndTime = now + BOOST_COOLDOWN_MS;
      this.speed = this.baseSpeed + BOOST_AMOUNT;
      this.addChatMessage(`加速！（${BOOST_DURATION_MS/1000} 秒）`, 'system');
      this.updateInfo();
    },

    // ---- ジャンプ（非稼働時は開始しない）----
    jump() {
      if (!this.isRunning) {
        this.addChatMessage('まず「すたーと」で開始してね。', 'system');
        return;
      }
      if (this.onGround) {
        this.onGround = false;
        this.playerVY = JUMP_VY;
      }
    },

    loop(ts) {
      if (!this.isRunning) return;
      const dt = (ts - this.lastTimestamp) / 1000;
      this.lastTimestamp = ts;

      // ブースト終了
      if (this.boostActive && ts >= this.boostEndTime) {
        this.boostActive = false;
        this.speed = this.baseSpeed;
        this.updateInfo();
      }

      // 距離
      this.distance += this.speed * dt;

      // 最高記録の更新
      if (this.distance > this.bestDistance) {
        const prevBest = this.bestDistance;
        this.bestDistance = this.distance;
        sessionStorage.setItem('miniGameBestPx', String(this.bestDistance));
        if (!this.bestAnnouncedThisRun && prevBest <= this.bestAtRunStart) {
          this.bestAnnouncedThisRun = true;
          this.addChatMessage(`最高記録更新！ ${Math.floor(this.bestDistance)} km`, 'system');
        }
      }

      // 背景スクロール（タイルリサイクルでシームなし）
      this.layers.forEach(layer => {
        layer.offset -= this.speed * layer.speedRatio * dt;

        while (layer.offset <= -TILE_WIDTH) {
          layer.offset += TILE_WIDTH;

          const first = layer.el.firstElementChild;
          if (first) {
            layer.el.appendChild(first);

            // 山は右端へ回した瞬間に次の高さを決定
            if (layer.el.classList.contains('bg-hills')) {
              const hChoice = MOUNTAIN_HEIGHT_CHOICES[
                Math.floor(Math.random() * MOUNTAIN_HEIGHT_CHOICES.length)
              ];
              const bg = makeMountainSVG(TILE_WIDTH, TILE_HEIGHT, hChoice, MOUNTAIN_GAP);
              first.style.backgroundImage = bg;
              first.style.backgroundRepeat = 'no-repeat';
              first.style.backgroundPosition = '0 100%';
              first.style.backgroundSize = `${TILE_WIDTH}px ${TILE_HEIGHT}px`;
            }
          }
        }

        layer.el.style.transform = `translateX(${layer.offset}px)`;
      });

      // 岩（生成・移動・衝突）
      this.updateRocks(dt);

      // ジャンプ更新
      this.updatePlayerVertical(dt);

      // UI更新
      this.updateInfo();

      requestAnimationFrame(this.loop.bind(this));
    },

    updatePlayerVertical(dt) {
      if (!this.playerEl) return;
      if (!this.onGround) {
        this.playerVY += GRAVITY * dt;
        this.playerY  += this.playerVY * dt;

        if (this.playerY > MAX_JUMP_HEIGHT) this.playerY = MAX_JUMP_HEIGHT;
        if (this.playerY <= 0) { this.playerY = 0; this.playerVY = 0; this.onGround = true; }

        this.applyPlayerTransform();
      }
    },

    applyPlayerTransform() {
      this.playerEl.style.transform = `translateY(${-this.playerY}px)`;
    },

    updateInfo() {
      if (this.distanceDisplay) this.distanceDisplay.textContent = Math.floor(this.distance);
      if (this.speedDisplay)    this.speedDisplay.textContent = Math.floor(this.speed);
      const bestEl = document.getElementById('best');
      if (bestEl) bestEl.textContent = Math.floor(this.bestDistance);
    },

    /* ==================== 岩：生成・描画・衝突 ==================== */
    updateRocks() {
      const boardWidth = this.gameBoard?.clientWidth || 1100;

      // 出現（距離ベース）
      if (this.distance >= this.nextRockAt) {
        this.spawnRock(this.distance + boardWidth + ROCK_SPAWN_MARGIN);
        const gap = randInt(ROCK_MIN_GAP, ROCK_MAX_GAP);
        this.nextRockAt += gap;
      }

      // 更新
      for (let i = this.rocks.length - 1; i >= 0; i--) {
        const r = this.rocks[i];

        // 画面X = ワールドX - 距離
        const screenX = r.x - this.distance;

        // 画面外で除去
        if (screenX + ROCK_W < -50) {
          r.el.remove();
          this.rocks.splice(i, 1);
          continue;
        }

        // 表示
        r.el.style.transform = `translateX(${Math.round(screenX)}px)`;

        // 衝突（AABB）
        if (!r.hit) {
          const playerBottom = GROUND_OFFSET + this.playerY;
          const playerLeft   = PLAYER_X;
          const playerRight  = PLAYER_X + PLAYER_W;

          const rockLeft  = screenX;
          const rockRight = screenX + ROCK_W;
          const rockTop   = GROUND_OFFSET + r.h;

          const xOverlap = !(playerRight < rockLeft || rockRight < playerLeft);
          const yOverlap = playerBottom < rockTop;

          if (xOverlap && yOverlap) {
            r.hit = true;
            this.onHitObstacle();
          }
        }
      }
    },

    spawnRock(worldX) {
      const h = ROCK_H_CHOICES[Math.floor(Math.random() * ROCK_H_CHOICES.length)];
      const el = document.createElement('div');
      el.className = 'rock';
      el.style.width  = `${ROCK_W}px`;
      el.style.height = `${h}px`;
      el.style.left   = `0px`;            // transform で動かす
      el.style.bottom = `${GROUND_OFFSET}px`;
      this.gameBoard.appendChild(el);

      this.rocks.push({ x: worldX, h, el, hit: false });
    },

    clearRocks() {
      this.rocks.forEach(r => r.el.remove());
      this.rocks = [];
    },

    onHitObstacle() {
      this.hitCount += 1;
      const remain = Math.max(0, 3 - this.hitCount);
      this.addChatMessage(`岩に当たった！ (${this.hitCount}/3)`, 'system');

      if (this.hitCount >= 3) {
        // ゲームオーバー → 停止＆初期化
        this.isRunning = false;

        this.speed = this.baseSpeed;
        this.playerY = 0; this.playerVY = 0; this.onGround = true;
        this.applyPlayerTransform();

        // 距離0に戻す（最高記録は保持）
        this.distance = 0;
        this.updateInfo();

        // レイヤー位置・岩・ブーストをリセット
        this.layers.forEach(l => { l.offset = 0; l.el.style.transform = 'translateX(0px)'; });
        this.clearRocks();
        this.nextRockAt = 600;
        this.boostActive = false;
        this.boostEndTime = 0;
        this.cooldownEndTime = 0;

        this.addChatMessage('ゲームオーバー！ 距離が0に戻りました。「すたーと」で再開できます。', 'system');
      } else {
        this.addChatMessage(`残りミス可能回数: ${remain}`, 'system');
      }
    },

    /* ================= レイヤー生成 ================= */
    buildLayers() {
      if (!this.gameBoard) return;

      const boardWidth = this.gameBoard.clientWidth || 1100;
      const needTiles  = Math.ceil(boardWidth / TILE_WIDTH) + 2;

      // 背景と障害物をリセット
      this.gameBoard.innerHTML = '';
      this.layers = [];
      this.clearRocks();

      LAYERS.forEach(cfg => {
        const layer = document.createElement('div');
        layer.className = `parallax ${cfg.class}`;
        layer.style.transform = 'translateX(0px)';
        const layerObj = { el: layer, speedRatio: cfg.speedRatio, offset: 0 };

        for (let i = 0; i < needTiles; i++) {
          const tile = document.createElement('div');
          tile.className = 'tile';

          if (cfg.class === 'bg-hills') {
            const hChoice = MOUNTAIN_HEIGHT_CHOICES[
              Math.floor(Math.random() * MOUNTAIN_HEIGHT_CHOICES.length)
            ];
            const bg = makeMountainSVG(TILE_WIDTH, TILE_HEIGHT, hChoice, MOUNTAIN_GAP);
            tile.style.backgroundImage = bg;
            tile.style.backgroundRepeat = 'no-repeat';
            tile.style.backgroundPosition = '0 100%';
            tile.style.backgroundSize = `${TILE_WIDTH}px ${TILE_HEIGHT}px`;
          }

          layer.appendChild(tile);
        }

        this.gameBoard.appendChild(layer);
        this.layers.push(layerObj);
      });

      // キャラを最前面へ戻す
      if (this.playerEl) {
        this.gameBoard.appendChild(this.playerEl);
        this.applyPlayerTransform();
      }
    },
  };

  // ユーティリティ
  function randInt(a, b) {
    return Math.floor(Math.random() * (b - a + 1)) + a;
  }

  window.addEventListener('DOMContentLoaded', () => Game.init());
})();
