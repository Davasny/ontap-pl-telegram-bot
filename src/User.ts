import { Chatbot } from "./Chatbot";

export class User {
  private readonly userId: string;
  private readonly chatbot: Chatbot;

  constructor(userId: string) {
    this.userId = userId;
    this.chatbot = new Chatbot(userId);
  }

  public processMessage = async (message: string): Promise<string> => {
    console.log(`[User ${this.userId}] received message: ${message}`);
    return await this.chatbot.processMessage(message);
  };
}
