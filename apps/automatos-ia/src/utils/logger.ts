import { EventEmitter } from "events";

export class AgentEventEmitter extends EventEmitter {
  log(message: string) {
    // Log to standard console of the server too
    console.log(message);
    this.emit("message", { type: "log", level: "info", message });
  }

  warn(message: string) {
    console.warn(message);
    this.emit("message", { type: "log", level: "warn", message });
  }

  error(message: string) {
    console.error(message);
    this.emit("message", { type: "log", level: "error", message });
  }

  step(step: any) {
    this.emit("message", { type: "step", step });
  }

  status(status: "idle" | "running_agent" | "recording_copilot") {
    this.emit("message", { type: "status", status });
  }
}

export const agentEvents = new AgentEventEmitter();
