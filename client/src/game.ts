import type { GameMessage, GameState } from "./gameTypes";

export class PongGame {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private width = 800;
  private height = 600;
  private isHost = false;
  private dataChannel: RTCDataChannel | null = null;
  private gameLoop: number | null = null; // アニメーションフレームの参照を保持

  // ゲーム要素
  private paddle1 = { x: 50, y: 250, width: 10, height: 100 };
  private paddle2 = { x: 740, y: 250, width: 10, height: 100 };
  private ball = { x: 400, y: 300, radius: 5, dx: 5, dy: 5 };
  private score = { player1: 0, player2: 0 };
  private gameStarted = false;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.ctx = this.canvas.getContext("2d");

    const gameArea = document.querySelector(".game-area");
    if (gameArea) {
      gameArea.innerHTML = "";
      gameArea.appendChild(this.canvas);
    }

    // キー入力のイベントリスナーを設定
    document.addEventListener("keydown", (e) => {
      // ゲームに関係するキーの場合、スクロールを防ぐ
      if (["ArrowUp", "ArrowDown", "Space"].includes(e.key)) {
        e.preventDefault();
      }
      this.handleKeyDown(e);
    });

    // フォーカス時の視覚的フィードバック用のスタイルを追加
    this.canvas.style.outline = "none";
    this.canvas.tabIndex = 1; // フォーカス可能にする
  }

  public setDataChannel(dataChannel: RTCDataChannel, isHost: boolean) {
    this.dataChannel = dataChannel;
    this.isHost = isHost;

    // ホストかゲストかをコンソールに表示（デバッグ用）
    console.log(`役割: ${isHost ? "ホスト" : "ゲスト"}`);
    console.log(`操作するパドル: ${isHost ? "左側" : "右側"}`);

    this.dataChannel.onmessage = (event) => {
      const message: GameMessage = JSON.parse(event.data);
      this.handleGameMessage(message);
    };

    // キャンバスにフォーカスを設定
    this.canvas.focus();
  }

  private handleGameMessage(message: GameMessage) {
    switch (message.type) {
      case "paddle_move":
        if (message.payload.y !== undefined) {
          if (this.isHost) {
            this.paddle2.y = message.payload.y;
          } else {
            this.paddle1.y = message.payload.y;
          }
        }
        break;
      case "game_state":
        if (message.payload.gameState && !this.isHost) {
          const state = message.payload.gameState;
          this.ball = state.ball;
          this.score = state.score;
          if (this.isHost) {
            this.paddle1 = state.paddle1;
          } else {
            this.paddle2 = state.paddle2;
          }
        }
        break;
      case "game_start":
        this.gameStarted = true;
        if (message.payload.gameState) {
          this.updateGameState(message.payload.gameState);
        }
        break;
    }
  }

  private updateGameState(state: GameState) {
    this.ball = state.ball;
    this.score = state.score;
    if (this.isHost) {
      this.paddle1 = state.paddle1;
    } else {
      this.paddle2 = state.paddle2;
    }
  }

  private sendGameState() {
    if (this.dataChannel?.readyState === "open") {
      const message: GameMessage = {
        type: "game_state",
        payload: {
          gameState: {
            paddle1: this.paddle1,
            paddle2: this.paddle2,
            ball: this.ball,
            score: this.score,
          },
        },
      };
      this.dataChannel.send(JSON.stringify(message));
    }
  }

  private handleKeyDown(e: KeyboardEvent) {
    if (!this.gameStarted) return;

    const speed = 20;
    let moved = false;

    // isHostに基づいて操作するパドルを決定
    const paddle = this.isHost ? this.paddle1 : this.paddle2;

    switch (e.key) {
      case "ArrowUp":
        paddle.y = Math.max(0, paddle.y - speed);
        moved = true;
        break;
      case "ArrowDown":
        paddle.y = Math.min(this.height - paddle.height, paddle.y + speed);
        moved = true;
        break;
    }

    if (moved && this.dataChannel?.readyState === "open") {
      const message: GameMessage = {
        type: "paddle_move",
        payload: {
          y: paddle.y,
        },
      };
      this.dataChannel.send(JSON.stringify(message));
    }
  }

  private draw() {
    // 背景をクリア
    this.ctx.fillStyle = "black";
    this.ctx.fillRect(0, 0, this.width, this.height);

    // パドルを描画（自分のパドルを強調表示）
    this.ctx.fillStyle = this.isHost ? "#ff6b6b" : "white";
    this.ctx.fillRect(this.paddle1.x, this.paddle1.y, this.paddle1.width, this.paddle1.height);

    this.ctx.fillStyle = !this.isHost ? "#ff6b6b" : "white";
    this.ctx.fillRect(this.paddle2.x, this.paddle2.y, this.paddle2.width, this.paddle2.height);

    // ボールを描画
    this.ctx.beginPath();
    this.ctx.arc(this.ball.x, this.ball.y, this.ball.radius, 0, Math.PI * 2);
    this.ctx.fillStyle = "white";
    this.ctx.fill();
    this.ctx.closePath();

    // スコアを描画
    this.ctx.fillStyle = "white";
    this.ctx.font = "24px Arial";
    this.ctx.fillText(this.score.player1.toString(), this.width / 4, 50);
    this.ctx.fillText(this.score.player2.toString(), (this.width * 3) / 4, 50);
  }

  private update() {
    if (!this.gameStarted) return;

    if (this.isHost) {
      // デバッグ用のログ
      console.log("Updating ball position:", { x: this.ball.x, y: this.ball.y, dx: this.ball.dx, dy: this.ball.dy });

      // ボールの移動
      this.ball.x += this.ball.dx;
      this.ball.y += this.ball.dy;

      // 上下の壁との衝突
      if (this.ball.y + this.ball.radius > this.height || this.ball.y - this.ball.radius < 0) {
        this.ball.dy *= -1;
      }

      // パドルとの衝突判定
      this.checkPaddleCollision();

      // 得点判定
      this.checkScore();

      // 状態を送信（毎フレーム）
      this.sendGameState();
    }
  }

  private checkPaddleCollision() {
    // パドル1（左）との衝突
    if (
      this.ball.x - this.ball.radius < this.paddle1.x + this.paddle1.width &&
      this.ball.x + this.ball.radius > this.paddle1.x &&
      this.ball.y > this.paddle1.y &&
      this.ball.y < this.paddle1.y + this.paddle1.height
    ) {
      this.ball.dx = Math.abs(this.ball.dx); // 右向きに変更
    }

    // パドル2（右）との衝突
    if (
      this.ball.x + this.ball.radius > this.paddle2.x &&
      this.ball.x - this.ball.radius < this.paddle2.x + this.paddle2.width &&
      this.ball.y > this.paddle2.y &&
      this.ball.y < this.paddle2.y + this.paddle2.height
    ) {
      this.ball.dx = -Math.abs(this.ball.dx); // 左向きに変更
    }
  }

  private checkScore() {
    // 左側の得点
    if (this.ball.x + this.ball.radius > this.width) {
      this.score.player1++;
      this.resetBall();
    }
    // 右側の得点
    if (this.ball.x - this.ball.radius < 0) {
      this.score.player2++;
      this.resetBall();
    }
  }

  private resetBall() {
    this.ball.x = this.width / 2;
    this.ball.y = this.height / 2;
    this.ball.dx = (Math.random() > 0.5 ? 1 : -1) * 5; // ランダムな方向
    this.ball.dy = (Math.random() * 2 - 1) * 5; // ランダムな上下の角度
  }

  public start() {
    this.gameStarted = true;
    this.resetBall();

    // すでにゲームループが動いている場合は停止
    if (this.gameLoop !== null) {
      cancelAnimationFrame(this.gameLoop);
    }

    // ゲームループの開始
    const animate = () => {
      this.update();
      this.draw();
      this.gameLoop = requestAnimationFrame(animate);
    };
    animate(); // ループを開始

    if (this.dataChannel?.readyState === "open") {
      const message: GameMessage = {
        type: "game_start",
        payload: {
          gameState: {
            paddle1: this.paddle1,
            paddle2: this.paddle2,
            ball: this.ball,
            score: this.score,
          },
        },
      };
      this.dataChannel.send(JSON.stringify(message));
    }
  }
}
