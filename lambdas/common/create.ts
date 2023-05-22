import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import * as uuid from 'uuid';

export const lambdaHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log(event);

  return {
    statusCode: 200,
    body: JSON.stringify({
      status: uuid.v1()
    }),
  };
};