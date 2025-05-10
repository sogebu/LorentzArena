type DataChannel =
  | { type: 'host'; channels: Map<string, RTCDataChannel> }
  | { type: 'client'; channel: RTCDataChannel }
  | { type: 'waiting' };

export type WebRTCClientOptions = {
  onMessage: (message: string, from: string) => void;
};

export class WebRTCClient {
  private peerConnection: RTCPeerConnection;
  private dataChannel: DataChannel;
  private onMessageCallback: (message: string, from: string) => void;
  private onIceCandidateCallback: ((candidate: RTCIceCandidateInit) => void) | null = null;

  constructor(options: WebRTCClientOptions) {
    this.dataChannel = { type: 'waiting' };
    this.onMessageCallback = options.onMessage;
    this.peerConnection = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate && this.onIceCandidateCallback) {
        this.onIceCandidateCallback(event.candidate);
      }
    };

    this.peerConnection.ondatachannel = (event) => {
      if (this.dataChannel.type !== 'host') {
        throw new Error('DataChannel is not host');
      }
      const clientId = event.channel.label;
      this.dataChannel.channels.set(clientId, event.channel);
      this.setupDataChannel(clientId, event.channel);
    };
  }

  private setupDataChannel(clientId: string, channel: RTCDataChannel) {
    channel.onmessage = (event) => {
      this.onMessageCallback(event.data, clientId);
    };

    channel.onopen = () => {
      console.log(`DataChannel with ${clientId} is open`);
    };

    channel.onclose = () => {
      console.log(`DataChannel with ${clientId} is closed`);
      // TODO データチャンネルを閉じる
    };
  }

  public async createOffer(targetClientId: string): Promise<RTCSessionDescriptionInit> {
    if (this.dataChannel.type !== 'waiting') {
      throw new Error('DataChannel is already set');
    }
    const dataChannel = this.peerConnection.createDataChannel(targetClientId);
    this.dataChannel = { type: 'client', channel: dataChannel };
    this.setupDataChannel(targetClientId, dataChannel);

    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);
    return offer;
  }

  public async handleOffer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    if (this.dataChannel.type !== 'waiting') {
      throw new Error('DataChannel is already set');
    }
    this.dataChannel = { type: 'host', channels: new Map() };
    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);
    return answer;
  }

  public async handleAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
  }

  public async handleIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
  }

  public onIceCandidate(callback: (candidate: RTCIceCandidateInit) => void): void {
    this.onIceCandidateCallback = callback;
  }

  public sendMessage(message: string): void {
    switch (this.dataChannel.type) {
      case 'host':
        for (const channel of this.dataChannel.channels.values()) {
          channel.send(message);
        }
        break;
      case 'client':
        this.dataChannel.channel.send(message);
        break;
      case 'waiting':
        throw new Error('DataChannel is not set');
    }
  }
}
