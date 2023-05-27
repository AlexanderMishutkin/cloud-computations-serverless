import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { S3 } from "aws-sdk";
import * as uuid from 'uuid';
import { UniversalFile } from "./common/entities";

const BUCKET = 'UserUploadBucket';
const s3 = new S3();

//.authorizer.claims['<user-attribute>']

export const post_file = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    if (!event.body) return { statusCode: 400, body: "No request body!" };
    let file: UniversalFile = JSON.parse(event.body);
    if (!file.data) return { statusCode: 400, body: "Client must send file with base64 encoded file data!" };

    try {
        const filename = `files/${}/${file.name} ${uuid.v1()}.${file.type}`
        await s3.putObject({ Bucket: BUCKET, Key: filename, Body: Buffer.from(file.data, 'base64') }).promise();

    } catch (err) {
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "File upload failed" })
        }
    }

    const s3_url = `https://${BUCKET}.s3.amazonaws.com/${filename}`

    return {
        statusCode: 200,
        body: JSON.stringify({ link:  })
    }
};

export const get_file

export const edit_file

export const delete_file
