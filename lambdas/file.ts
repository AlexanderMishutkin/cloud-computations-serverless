import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { DynamoDB, S3 } from "aws-sdk";
import * as uuid from 'uuid';
import { Album, UniversalFile } from "./common/entities";
import { generateSafeS3Name } from "./common/utils";

const BUCKET = 'tim18-cloud-computing-user-upload';
const s3 = new S3();
const dynamoDB = new DynamoDB.DocumentClient();


export const postFile = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    // Some important routine
    if (!event.body) return { statusCode: 400, body: "No request body!" };
    let file: UniversalFile = JSON.parse(event.body);
    if (!file.data) return { statusCode: 400, body: "Client must send file with base64 encoded file data!" };
    if (!event.requestContext.authorizer) return {
        statusCode: 403,
        body: "You need to authorize via Cognito! To debud via API Gateway - add 'Authorization' header. To debug via lambda - add requestContext.authorizer.claims manually"
    };
    const sub = event.requestContext.authorizer.claims['sub'];
    const email = event.requestContext.authorizer.claims['email'];
    file.file_id = uuid.v1();

    // Put file to S3
    const filename = `files/${generateSafeS3Name(email)}/${generateSafeS3Name(file.name)}_${file.file_id}.${file.type}`;
    await s3.putObject({ Bucket: BUCKET, Key: filename, Body: Buffer.from(file.data, 'base64') }).promise();
    file.s3_url = `https://${BUCKET}.s3.amazonaws.com/${filename}`;
    file.user_sub = sub;
    file.data = undefined;

    // Put meta data to dynamoDB
    dynamoDB.put({
        TableName: "Files",
        Item: {
            ...file
        }
    }, console.log);

    return {
        statusCode: 200,
        body: JSON.stringify(file)
    };
};

export const getFile = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    // Some important routine
    if (!event.requestContext.authorizer) return {
        statusCode: 403,
        body: "You need to authorize via Cognito! To debud via API Gateway - add 'Authorization' header. To debug via lambda - add requestContext.authorizer.claims manually"
    };
    const sub = event.requestContext.authorizer.claims['sub'];
    const email = event.requestContext.authorizer.claims['email'];
    const { user_sub, file_id } = event.pathParameters as { user_sub: string, file_id: string };

    // Get meta from DynamoDB
    let responce = await dynamoDB.get({
        TableName: "Files",
        Key: {
            user_sub: user_sub,
            file_id: file_id
        }
    }).promise();
    let file = responce.Item as UniversalFile;

    // Get album
    responce = await dynamoDB.get({
        TableName: "Albums",
        Key: {
            user_sub: file.user_sub,
            album_id: file.album_id
        }
    }).promise();
    let album = responce.Item as Album;

    // Security
    if (
        file.user_sub != sub &&
        !(email in file.sharedWithEmails) &&
        !(album && email in album.sharedWithEmails)
    ) return { statusCode: 403, body: "File do not exists or you are not allowed to see it!" };

    // Get data from S3
    if (!file.s3_url) return { statusCode: 500, body: "Broken File metadata!" };
    let data = await s3.getObject({
        Bucket: BUCKET,
        Key: file.s3_url.replace(`https://${BUCKET}.s3.amazonaws.com/`, '')
    }).promise();
    file.data = data.Body?.toString("base64");

    return {
        statusCode: 200,
        body: JSON.stringify(file)
    };
};

// export const editFile

// export const deleteFile
