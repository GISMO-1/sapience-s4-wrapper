import { Kafka, Producer } from "kafkajs";
import { config } from "../config";

const kafka = new Kafka({ clientId: config.serviceName, brokers: config.brokerBrokers });

export const producer: Producer = kafka.producer();

export async function startProducer(): Promise<void> {
  await producer.connect();
}

export async function stopProducer(): Promise<void> {
  await producer.disconnect();
}
