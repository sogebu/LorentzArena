// シグナリングメッセージの型定義
interface SignalingMessage {
  type: string;
  payload: Record<string, unknown>;
  from: string;
  to: string;
  timestamp: number;
}

export class SignalingClient {
  private baseUrl: string;
  private clientId: string | null = null;
  private onOfferCallback: ((offer: RTCSessionDescriptionInit, from: string) => void) | null = null;
  private onAnswerCallback: ((answer: RTCSessionDescriptionInit) => void) | null = null;
  private onIceCandidateCallback: ((candidate: RTCIceCandidateInit) => void) | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  public async connect(): Promise<string> {
    const response = await fetch(`${this.baseUrl}/connect`, {
      method: 'POST',
    });
    const data = await response.json();
    this.clientId = data.payload.clientId;
    return this.clientId;
  }

  public async getClients(): Promise<string[]> {
    if (!this.clientId) throw new Error('Not connected to signaling server');

    const response = await fetch(`${this.baseUrl}/clients?clientId=${this.clientId}`);
    const data = await response.json();
    return data.clients;
  }

  public async sendOffer(targetClientId: string, offer: RTCSessionDescriptionInit): Promise<void> {
    if (!this.clientId) throw new Error('Not connected to signaling server');

    await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'offer',
        payload: { offer },
        from: this.clientId,
        to: targetClientId,
      }),
    });
  }

  public async sendAnswer(targetClientId: string, answer: RTCSessionDescriptionInit): Promise<void> {
    if (!this.clientId) throw new Error('Not connected to signaling server');

    await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'answer',
        payload: { answer },
        from: this.clientId,
        to: targetClientId,
      }),
    });
  }

  public async sendIceCandidate(targetClientId: string, candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.clientId) throw new Error('Not connected to signaling server');

    await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'ice',
        payload: { candidate },
        from: this.clientId,
        to: targetClientId,
      }),
    });
  }

  public onOffer(callback: (offer: RTCSessionDescriptionInit, from: string) => void): void {
    this.onOfferCallback = callback;
  }

  public onAnswer(callback: (answer: RTCSessionDescriptionInit) => void): void {
    this.onAnswerCallback = callback;
  }

  public onIceCandidate(callback: (candidate: RTCIceCandidateInit) => void): void {
    this.onIceCandidateCallback = callback;
  }

  public startPolling(): void {
    setInterval(async () => {
      if (!this.clientId) return;

      const response = await fetch(`${this.baseUrl}/messages?clientId=${this.clientId}`);
      const messages: SignalingMessage[] = await response.json();

      for (const message of messages) {
        if (message.type === 'offer' && this.onOfferCallback && message.payload.offer) {
          this.onOfferCallback(message.payload.offer as RTCSessionDescriptionInit, message.from);
        } else if (message.type === 'answer' && this.onAnswerCallback && message.payload.answer) {
          this.onAnswerCallback(message.payload.answer as RTCSessionDescriptionInit);
        } else if (message.type === 'ice' && this.onIceCandidateCallback && message.payload.candidate) {
          this.onIceCandidateCallback(message.payload.candidate as RTCIceCandidateInit);
        }
      }
    }, 1000);
  }
}
