import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import * as uuid from 'uuid';

export const lambdaHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log(event);

  return {
    statusCode: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'OPTIONS,POST',
    },
    body: JSON.stringify({
      uuid: uuid.v1(),
      user: event.requestContext.accountId
    }),
  };
};