import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

export const lambdaHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log(event);

  return {
    statusCode: 200,
    body: JSON.stringify({
      status: "ok"
    }),
  };
};