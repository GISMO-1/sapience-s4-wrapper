import { Kafka, Consumer } from "kafkajs";
import { config } from "../config";

const kafka = new Kafka({ clientId: config.serviceName, brokers: config.brokerBrokers });

export const consumer: Consumer = kafka.consumer({ groupId: "orchestration-service-group" });

export async function startConsumer(): Promise<void> {
  await consumer.connect();
}

export async function stopConsumer(): Promise<void> {
  await consumer.disconnect();
}
