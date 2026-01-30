import { Kafka, Consumer } from "kafkajs";
import { config } from "../config";
import { logger } from "../logger";

const kafka = new Kafka({ clientId: config.serviceName, brokers: config.brokerBrokers });

export const consumer: Consumer = kafka.consumer({ groupId: "supplychain-service-group" });

export async function startConsumer(): Promise<void> {
  await connectWithRetry(() => consumer.connect(), "Kafka consumer");
}

export async function stopConsumer(): Promise<void> {
  await consumer.disconnect();
}

const initialDelayMs = 500;
const maxDelayMs = 5000;

async function connectWithRetry(action: () => Promise<void>, label: string): Promise<void> {
  let delay = initialDelayMs;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await action();
      logger.info({ label, traceId: "system" }, "Connected to Kafka");
      return;
    } catch (error) {
      logger.warn({ error, label, delay, traceId: "system" }, "Kafka connection failed; retrying");
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, maxDelayMs);
    }
  }
}
