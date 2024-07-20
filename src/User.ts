import { Agent } from "./Agent";

export class User {
  private readonly userId: string;
  private readonly chatbot: Agent;

  constructor(userId: string) {
    this.userId = userId;
    this.chatbot = new Agent(userId);
  }

  public processMessage = async (message: string): Promise<string> => {
    console.log(`[User ${this.userId}] received message: ${message}`);
    return await this.chatbot.processMessage(message);
  };
}
