type DataConnection = {
  isHost: true,
  channels: Map<string, RTCDataChannel>
} | {
  isHost: false,
  channel: RTCDataChannel
};

export class WebRTCClient {
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannels = new Map<string, RTCDataChannel>();
  private onMessageCallback: ((message: string, from: string) => void) | null = null;
  private onIceCandidateCallback: ((candidate: RTCIceCandidateInit) => void) | null = null;
  private isHost = false;

  constructor() {
    this.peerConnection = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate && this.onIceCandidateCallback) {
        this.onIceCandidateCallback(event.candidate);
      }
    };

    this.peerConnection.ondatachannel = (event) => {
      const clientId = event.channel.label;
      this.setupDataChannel(clientId, event.channel);
    };
  }

  private setupDataChannel(clientId: string, channel: RTCDataChannel) {
    this.dataChannels.set(clientId, channel);

    channel.onmessage = (event) => {
      if (this.onMessageCallback) {
        this.onMessageCallback(event.data, clientId);
      }
    };

    channel.onopen = () => {
      console.log(`DataChannel with ${clientId} is open`);
    };

    channel.onclose = () => {
      console.log(`DataChannel with ${clientId} is closed`);
      this.dataChannels.delete(clientId);
    };
  }

  public async createOffer(clientId: string): Promise<RTCSessionDescriptionInit> {
    if (!this.peerConnection) throw new Error('PeerConnection is not initialized');

    const dataChannel = this.peerConnection.createDataChannel(clientId);
    this.setupDataChannel(clientId, dataChannel);

    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);
    return offer;
  }

  public async handleOffer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    if (!this.peerConnection) throw new Error('PeerConnection is not initialized');

    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);
    return answer;
  }

  public async handleAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    if (!this.peerConnection) throw new Error('PeerConnection is not initialized');
    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
  }

  public async handleIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.peerConnection) throw new Error('PeerConnection is not initialized');
    await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
  }

  public sendMessage(message: string): void {
    for (const channel of this.dataChannels.values()) {
      console.log(`Channel ${channel}`);
      if (channel.readyState === 'open') {
        channel.send(message);
        console.log(`Message ${message} sent to ${channel}`);
      }
    }
  }

  public onMessage(callback: (message: string, from: string) => void): void {
    this.onMessageCallback = callback;
  }

  public onIceCandidate(callback: (candidate: RTCIceCandidateInit) => void): void {
    this.onIceCandidateCallback = callback;
  }

  public setHost(isHost: boolean): void {
    this.isHost = isHost;
  }

  public isHostMode(): boolean {
    return this.isHost;
  }
}
