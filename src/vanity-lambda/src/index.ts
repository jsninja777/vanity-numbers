import { getVanityNumbers } from "./generator";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";


const TABLE_NAME = process.env.TABLE_NAME || "VanityResults";
const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

interface ConnectEvent {
  callerNumber?: string;
  Details?: {
    ContactData?: {
      CustomerEndpoint?: {
        Address?: string;
        Type?: string;
      };
      ContactId?: string;
      Channel?: string;
    };
    Parameters?: Record<string, string>;
  };
}

type VanityLambdaResult = {
  message: string;
  error?: string;
};

const saveToDynamo = async (caller: string, best5: string[]): Promise<void> => {
  const tstamp = Date.now().toString();
  const item = {
    callerNumber: caller,
    timestamp: tstamp,
    bestVanities: best5,
    ttl: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30
  };
  const putCommand = new PutCommand({ TableName: TABLE_NAME, Item: item });
  await docClient.send(putCommand);
}

export const handler = async (event: ConnectEvent): Promise<VanityLambdaResult> => {
  console.log("Event:", event);
  const callerNumber =
    event?.Details?.Parameters?.callerNumber ||
    event?.Details?.ContactData?.CustomerEndpoint?.Address ||
    event?.callerNumber;

  console.log("Resolved callerNumber:", callerNumber);

  if (!callerNumber) {
    return { message: "callerNumber required", error: "callerNumber required" };
  }

  const top5 = getVanityNumbers(callerNumber, 5);
  await saveToDynamo(callerNumber, top5);

  console.log("Top 5:", top5);
  console.log("Top 3:", top5.slice(0, 3));
  console.log("Top 5:", `Here is the top 3 vanity numbers for your phone: ${top5.slice(0, 3).join(", ")}`);

  return {message: "Here is the top 3 vanity numbers for your phone: " + top5.slice(0, 3).join(", ")};
  
};
