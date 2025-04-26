export class WebRTCClient {
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private onMessageCallback: ((message: string) => void) | null = null;
  private onIceCandidateCallback: ((candidate: RTCIceCandidateInit) => void) | null = null;

  constructor() {
    this.peerConnection = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });

    this.setupPeerConnectionListeners();
  }

  private setupPeerConnectionListeners() {
    if (!this.peerConnection) return;

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate && this.onIceCandidateCallback) {
        this.onIceCandidateCallback(event.candidate);
      }
    };

    this.peerConnection.ondatachannel = (event) => {
      this.setupDataChannel(event.channel);
    };
  }

  private setupDataChannel(channel: RTCDataChannel) {
    this.dataChannel = channel;

    this.dataChannel.onmessage = (event) => {
      if (this.onMessageCallback) {
        this.onMessageCallback(event.data);
      }
    };

    this.dataChannel.onopen = () => {
      console.log('DataChannel is open');
    };

    this.dataChannel.onclose = () => {
      console.log('DataChannel is closed');
    };
  }

  public async createOffer(): Promise<RTCSessionDescriptionInit> {
    if (!this.peerConnection) throw new Error('PeerConnection is not initialized');

    this.dataChannel = this.peerConnection.createDataChannel('chat');
    this.setupDataChannel(this.dataChannel);

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
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      throw new Error('DataChannel is not open');
    }
    this.dataChannel.send(message);
  }

  public onMessage(callback: (message: string) => void): void {
    this.onMessageCallback = callback;
  }

  public onIceCandidate(callback: (candidate: RTCIceCandidateInit) => void): void {
    this.onIceCandidateCallback = callback;
  }

  public close(): void {
    if (this.dataChannel) {
      this.dataChannel.close();
    }
    if (this.peerConnection) {
      this.peerConnection.close();
    }
  }
}
