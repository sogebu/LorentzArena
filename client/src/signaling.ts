// シグナリングメッセージの型定義
type SignalingMessage<T extends string, P> = {
  type: T;
  payload: P;
  from: string;
  to: string;
  timestamp: number;
};

type OfferMessage = SignalingMessage<'offer', { offer: RTCSessionDescriptionInit }>;
type AnswerMessage = SignalingMessage<'answer', { answer: RTCSessionDescriptionInit }>;
type IceCandidateMessage = SignalingMessage<'ice', { candidate: RTCIceCandidateInit }>;

export type SignalingClientOptions = {
  baseUrl: string;
  clientId: string;
  onOffer: (offer: RTCSessionDescriptionInit, from: string) => void;
  onAnswer: (answer: RTCSessionDescriptionInit) => void;
  onIceCandidate: (candidate: RTCIceCandidateInit) => void;
};

type ConnectState = 'waiting' | 'offerSend' | 'offerReceive' | 'answerSend' | 'answerReceive' | 'connected';

export class SignalingClient {
  private baseUrl: string;
  private clientId: string;
  private state: ConnectState = 'waiting';
  private polling: NodeJS.Timeout | null = null;
  private onOfferCallback: (offer: RTCSessionDescriptionInit, from: string) => void;
  private onAnswerCallback: (answer: RTCSessionDescriptionInit) => void;
  private onIceCandidateCallback: (candidate: RTCIceCandidateInit) => void;

  constructor(options: SignalingClientOptions) {
    this.baseUrl = options.baseUrl;
    this.clientId = options.clientId;
    this.onOfferCallback = options.onOffer;
    this.onAnswerCallback = options.onAnswer;
    this.onIceCandidateCallback = options.onIceCandidate;
  }

  public async connect(): Promise<void> {
    const params = new URLSearchParams({ clientId: this.clientId });
    const response = await fetch(`${this.baseUrl}/connect?${params}`, {
      method: 'POST',
    });
    if (response.status !== 200) {
      throw new Error('Failed to connect to signaling server');
    }
  }

  public async getClients(): Promise<string[]> {
    const params = new URLSearchParams({ clientId: this.clientId });
    const response = await fetch(`${this.baseUrl}/clients?${params}`);
    if (response.status !== 200) {
      throw new Error('Failed to get clients from signaling server');
    }
    const data = await response.json();
    return data.clients;
  }

  public async sendOffer(targetClientId: string, offer: RTCSessionDescriptionInit): Promise<void> {
    if (this.state !== 'waiting') {
      throw new Error(`Invalid state: ${this.state}`);
    }
    const params = new URLSearchParams({ clientId: this.clientId });
    const response = await fetch(`${this.baseUrl}/messages?${params}`, {
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
    if (response.status !== 200) {
      throw new Error('Failed to send offer to signaling server');
    }
    this.state = 'offerSend';
  }

  public async sendAnswer(targetClientId: string, answer: RTCSessionDescriptionInit): Promise<void> {
    if (this.state !== 'offerReceive') {
      throw new Error(`Invalid state: ${this.state}`);
    }
    const params = new URLSearchParams({ clientId: this.clientId });
    const response = await fetch(`${this.baseUrl}/messages?${params}`, {
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
    if (response.status !== 200) {
      throw new Error('Failed to send answer to signaling server');
    }
    this.state = 'answerSend';
  }

  public async sendIceCandidate(targetClientId: string, candidate: RTCIceCandidateInit): Promise<void> {
    const params = new URLSearchParams({ clientId: this.clientId });
    const response = await fetch(`${this.baseUrl}/messages?${params}`, {
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
    if (response.status !== 200) {
      throw new Error('Failed to send ice candidate to signaling server');
    }
  }

  public startPolling(): void {
    if (this.polling) {
      return;
    }
    this.polling = setInterval(async () => {
      const response = await fetch(`${this.baseUrl}/messages?clientId=${this.clientId}`);
      if (response.status !== 200) {
        if (this.polling) {
          clearInterval(this.polling);
          this.polling = null;
        }
        throw new Error('Failed to get messages from signaling server');
      }
      const messages: (OfferMessage | AnswerMessage | IceCandidateMessage)[] = await response.json();
      console.log(messages);
      messages.sort((a, b) => a.timestamp - b.timestamp);

      for (const message of messages) {
        switch (message.type) {
          case 'offer':
            if (this.state !== 'waiting') {
              throw new Error(`Invalid state: ${this.state}`);
            }
            this.state = 'offerReceive';
            this.onOfferCallback(message.payload.offer, message.from);
            break;
          case 'answer':
            if (this.state !== 'offerSend') {
              throw new Error(`Invalid state: ${this.state}`);
            }
            this.state = 'answerReceive';
            this.onAnswerCallback(message.payload.answer as RTCSessionDescriptionInit);
            break;
          case 'ice':
            this.onIceCandidateCallback(message.payload.candidate as RTCIceCandidateInit);
            break;
        }
      }
    }, 3000);
  }
}
