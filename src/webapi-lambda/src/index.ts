// Minimal local types to avoid external type dependency in Lambda build
type APIGatewayProxyEvent = any;
type APIGatewayProxyResult = { statusCode: number; headers?: Record<string, string>; body: string };
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";

const TABLE_NAME = process.env.TABLE_NAME || "VanityResults";
const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

export const handler = async (_event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const scanCommand = new ScanCommand({
      TableName: TABLE_NAME,
      ProjectionExpression: "callerNumber, #ts, bestVanities",
      ExpressionAttributeNames: { "#ts": "timestamp" }
    });
    const resp = await docClient.send(scanCommand);
    const items = resp.Items || [];
    items.sort((a: any, b: any) => Number(b.timestamp) - Number(a.timestamp));
    const top5 = items.slice(0, 5);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify(top5)
    };
  } catch (err: any) {
    console.error("/last5 error", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ message: "Internal server error", error: err?.message || String(err) })
    };
  }
};
