import { PongGame } from "./game";
import { createSignaling } from "./signaling";

const createGameConnection = () => {
  let peerConnection: RTCPeerConnection | null = null;
  let dataChannel: RTCDataChannel | null = null;
  let isHost = false;
  let remoteClientId: string | null = null;
  const signaling = createSignaling();

  const statusElement = document.getElementById("connectionStatus") as HTMLDivElement;
  const messagesElement = document.getElementById("messages") as HTMLDivElement;
  const debugInfoElement = document.getElementById("debugInfo") as HTMLDivElement;
  const createOfferButton = document.getElementById("createOfferButton") as HTMLButtonElement;
  const sendTestMessageButton = document.getElementById("sendTestMessage") as HTMLButtonElement;

  if (sendTestMessageButton) {
    sendTestMessageButton.textContent = "ゲーム開始";
  }

  const updateStatus = (status: string) => {
    if (statusElement) {
      statusElement.textContent = status;
    }
  };

  const addMessage = (message: string) => {
    if (messagesElement) {
      const messageElement = document.createElement("div");
      messageElement.textContent = `${new Date().toLocaleTimeString()} ${message}`;
      messagesElement.appendChild(messageElement);
      messagesElement.scrollTop = messagesElement.scrollHeight;
    }
  };

  const updateDebugInfo = () => {
    if (debugInfoElement) {
      debugInfoElement.innerHTML = `
        クライアントID: ${signaling.getClientId() || "未取得"}<br>
        WebRTC状態: ${peerConnection?.connectionState || "未接続"}<br>
        DataChannel状態: ${dataChannel?.readyState || "未接続"}
      `;
    }
  };

  const initConnection = () => {
    signaling.connect();

    signaling.on("connected", (payload) => {
      console.log("シグナリングサーバーに接続:", payload);
      updateStatus(`シグナリングサーバーに接続（ID: ${payload.clientId}）`);
      createOfferButton.disabled = false;
      updateDebugInfo();
    });

    signaling.on("offer", (payload) => {
      console.log("オファーを受信:", payload);
      remoteClientId = payload.from;
      handleOffer(payload);
    });

    signaling.on("answer", async (payload) => {
      console.log("アンサーを受信:", payload);
      if (peerConnection) {
        try {
          await peerConnection.setRemoteDescription(payload);
        } catch (e) {
          console.error("アンサーの設定に失敗:", e);
        }
      }
    });

    signaling.on("candidate", async (payload) => {
      console.log("ICE candidateを受信:", payload);
      if (peerConnection) {
        try {
          await peerConnection.addIceCandidate(payload);
        } catch (e) {
          console.error("ICE candidateの追加に失敗:", e);
        }
      }
    });

    // WebRTC接続の初期化
    peerConnection = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        signaling.send({
          type: "candidate",
          payload: event.candidate,
          to: remoteClientId,
        });
      }
    };

    // データチャネルの設定
    dataChannel = peerConnection.createDataChannel("game");
    setupDataChannel(dataChannel);

    peerConnection.ondatachannel = (event) => {
      setupDataChannel(event.channel);
    };

    updateDebugInfo();
  };

  const setupDataChannel = (channel: RTCDataChannel) => {
    dataChannel = channel;

    channel.onopen = () => {
      updateStatus("ピア接続済み");
      addMessage("データチャネルが開きました");
      sendTestMessageButton.disabled = false;
      updateDebugInfo();

      console.log("接続役割:", isHost ? "ホスト" : "ゲスト");
      game.setDataChannel(channel, isHost);
    };

    channel.onclose = () => {
      updateStatus("ピア切断");
      addMessage("データチャネルが閉じました");
      sendTestMessageButton.disabled = true;
      updateDebugInfo();
    };

    channel.onerror = (error) => {
      console.error("データチャネルエラー:", error);
      addMessage("データチャネルでエラーが発生しました");
      updateDebugInfo();
    };
  };

  const createOffer = async () => {
    if (!peerConnection) return;
    isHost = true;
    try {
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      signaling.send({
        type: "offer",
        payload: offer,
        to: remoteClientId,
      });
    } catch (e) {
      console.error("オファーの作成に失敗:", e);
    }
  };

  const handleOffer = async (offer: RTCSessionDescriptionInit) => {
    if (!peerConnection) return;
    isHost = false;
    try {
      await peerConnection.setRemoteDescription(offer);
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      signaling.send({
        type: "answer",
        payload: answer,
        to: remoteClientId,
      });
    } catch (e) {
      console.error("オファーの処理に失敗:", e);
    }
  };

  const sendMessage = () => {
    if (dataChannel?.readyState === "open") {
      game.start();
      addMessage("ゲームを開始しました");
    } else {
      addMessage("エラー: 接続が確立されていません");
    }
  };

  return {
    init: initConnection,
    createOffer,
    sendMessage,
  };
};

// ゲームの初期化
const game = new PongGame();
const connection = createGameConnection();

// UIイベントの設定
document.getElementById("connectButton")?.addEventListener("click", () => {
  connection.init();
});

document.getElementById("createOfferButton")?.addEventListener("click", () => {
  connection.createOffer();
});

document.getElementById("sendTestMessage")?.addEventListener("click", () => {
  connection.sendMessage();
});
