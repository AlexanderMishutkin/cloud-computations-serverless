import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { DynamoDB, S3 } from "aws-sdk";
import * as uuid from 'uuid';
import { UniversalFile } from "./common/entities";
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
            // user_sub: { S: file.user_sub },
            // file_id: { S: file.file_id },
            // name: { S: file.name },
            // type: { S: file.type },
            // size: { N: file.size },
            // creationDate: { S: file.creationDate },
            // lastUpdate: { S: file.lastUpdate },
            // sharedWithEmails: { S: file.sharedWithEmails },
            // album_id: { S: file.album_id },
            // s3_url: { S: file.s3_url },
        }
    }, console.log);

    return {
        statusCode: 200,
        body: JSON.stringify(file)
    };
};

// export const get_file = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
//     if (!event.requestContext.authorizer) return {
//         statusCode: 403, 
//         body: "You need to authorize via Cognito! To debud via API Gateway - add 'Authorization' header. To debug via lambda - add requestContext.authorizer.claims manually"
//     };
//     const sub = event.requestContext.authorizer.claims['sub'];
//     const email = event.requestContext.authorizer.claims['email'];

//     try {
//         const filename = `files/${email}/${generateSafeS3Name(file.name)} ${uuid.v1()}.${file.type}`;
//         await s3.putObject({ Bucket: BUCKET, Key: filename, Body: Buffer.from(file.data, 'base64') }).promise();
//         file.s3_url = `https://${BUCKET}.s3.amazonaws.com/${filename}`;
//         file.data = undefined;
//     } catch (err) {
//         return {
//             statusCode: 500,
//             body: JSON.stringify({ message: "File upload failed" })
//         };
//     }

//     return {
//         statusCode: 200,
//         body: JSON.stringify(file)
//     };
// };

// export const editFile

// export const deleteFile
