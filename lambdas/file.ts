import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { DynamoDB, S3 } from "aws-sdk";
import * as uuid from 'uuid';
import { Album, UniversalFile } from "./common/entities";
import { generateSafeS3Name } from "./common/utils";

const BUCKET = 'tim18-cloud-computing-user-upload';
const s3 = new S3();
const dynamoDB = new DynamoDB.DocumentClient();
const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'OPTIONS,GET,PUT,POST,DELETE',
}


export const postFile = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    // Some important routine
    if (!event.body) return { headers: headers, statusCode: 400, body: "No request body!" };
    let file: UniversalFile = JSON.parse(event.body);
    if (!file.data) return { headers: headers, statusCode: 400, body: "Client must send file with base64 encoded file data!" };
    if (!event.requestContext.authorizer) return {
        headers: headers, statusCode: 403,
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
    file.creation_date = new Date().toLocaleDateString();
    file.last_update = file.creation_date;
    await dynamoDB.put({
        TableName: "Files",
        Item: {
            ...file
        }
    }).promise();

    return {
        headers: headers, statusCode: 200,
        body: JSON.stringify(file)
    };
};

export const getFile = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    // Some important routine
    if (!event.requestContext.authorizer) return {
        headers: headers, statusCode: 403,
        body: "You need to authorize via Cognito! To debud via API Gateway - add 'Authorization' header. To debug via lambda - add requestContext.authorizer.claims manually"
    };
    const sub = event.requestContext.authorizer.claims['sub'];
    const email = event.requestContext.authorizer.claims['email'];
    const { file_id } = event.pathParameters as { file_id: string };

    // Get meta from DynamoDB
    let responce = await dynamoDB.get({
        TableName: "Files",
        Key: {
            file_id: file_id
        }
    }).promise();
    let file = responce.Item as UniversalFile;
    if (!file) return { headers: headers, statusCode: 404, body: "File not found!" };

    // Get album
    responce = await dynamoDB.get({
        TableName: "Albums",
        Key: {
            album_id: file.album_id
        }
    }).promise();
    let album = responce.Item as Album;

    // Security
    if (
        file.user_sub != sub &&
        !(email in file.shared_with_emails) &&
        !(album && email in album.shared_with_emails)
    ) return { headers: headers, statusCode: 403, body: "File do not exists or you are not allowed to see it!" };

    // Get data from S3
    if (!file.s3_url) return { headers: headers, statusCode: 500, body: "Broken File metadata!" };
    let data = await s3.getObject({
        Bucket: BUCKET,
        Key: file.s3_url.replace(`https://${BUCKET}.s3.amazonaws.com/`, '')
    }).promise();
    file.data = data.Body?.toString("base64");

    return {
        headers: headers, statusCode: 200,
        body: JSON.stringify(file)
    };
};

export const getFiles = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    // Some important routine
    if (!event.requestContext.authorizer) return {
        headers: headers, statusCode: 403,
        body: "You need to authorize via Cognito! To debud via API Gateway - add 'Authorization' header. To debug via lambda - add requestContext.authorizer.claims manually"
    };
    const sub = event.requestContext.authorizer.claims['sub'];
    const email = event.requestContext.authorizer.claims['email'];

    // Get USER'S meta from DynamoDB
    const params = {
        TableName: 'Files',
        FilterExpression: 'user_sub = :sub',
        ExpressionAttributeValues: {
          ':sub': sub
        }
    };
    let responce = await dynamoDB.scan(params).promise();
    let my_files = responce.Items as UniversalFile[];
    
    // Get SHARED meta from DynamoDB
    const params1 = {
        TableName: 'Files',
        FilterExpression: 'contains(shared_with_emails, :email)',
        ExpressionAttributeValues: {
          ':email': email
        }
    };
    responce = await dynamoDB.scan(params1).promise();
    let shared_files: UniversalFile[] = [];
    shared_files.push(...responce.Items as UniversalFile[]);

    // Get SHARED albums
    const params2 = {
        TableName: 'Albums',
        FilterExpression: 'contains(shared_with_emails, :email)',
        ExpressionAttributeValues: {
          ':email': email
        }
    };
    responce = await dynamoDB.scan(params2).promise();
    let albums = responce.Items as Album[];
    for (let album of albums) {
        const params = {
            TableName: 'Files',
            FilterExpression: 'album_id = :id',
            ExpressionAttributeValues: {
              ':id': album.album_id
            }
        };
        let responce = await dynamoDB.scan(params).promise();
        shared_files.push(...responce.Items as UniversalFile[]);
    }

    return {
        statusCode: 200, headers: headers,
        body: JSON.stringify({
            my_files: my_files,
            shared_files: shared_files
        })
    };
};

export const editFile = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    // Some important routine
    if (!event.requestContext.authorizer) return {
        headers: headers, statusCode: 403,
        body: "You need to authorize via Cognito! To debud via API Gateway - add 'Authorization' header. To debug via lambda - add requestContext.authorizer.claims manually"
    };
    const sub = event.requestContext.authorizer.claims['sub'];
    const email = event.requestContext.authorizer.claims['email'];
    if (!event.body) return { headers: headers, statusCode: 400, body: "No request body!" };
    let new_file: UniversalFile = JSON.parse(event.body);

    // Get meta from DynamoDB
    let responce = await dynamoDB.get({
        TableName: "Files",
        Key: {
            file_id: new_file.file_id
        }
    }).promise();
    let file = responce.Item as UniversalFile;
    if (!file) return { statusCode: 404, body: "File not found!" };

    // Security
    if (file.user_sub != sub) return { headers: headers, statusCode: 403, body: "File must be your's!" };
    if (new_file.user_sub && new_file.user_sub != sub) return { headers: headers, statusCode: 403, body: "Can not reassign file!" };

    // Optionally update data
    if (new_file.data && file.s3_url) {
        await s3.putObject({ Bucket: BUCKET, Key: file.s3_url.replace(`https://${BUCKET}.s3.amazonaws.com/`, ''), Body: Buffer.from(new_file.data, 'base64') }).promise();
        new_file.data = undefined;
        new_file.s3_url = file.s3_url;
    } else {
        if (new_file.data) {
            const filename = `files/${generateSafeS3Name(email)}/${generateSafeS3Name(file.name)}_${file.file_id}.${file.type}`;
            await s3.putObject({ Bucket: BUCKET, Key: filename, Body: Buffer.from(new_file.data, 'base64') }).promise();
            new_file.s3_url = `https://${BUCKET}.s3.amazonaws.com/${filename}`;
            new_file.data = undefined;
        }
    }

    let to_save = {
        ...file,
        ...new_file
    }
    await dynamoDB.delete({
        TableName : 'Files',
        Key: {
            file_id: new_file.file_id
        }
    }).promise()
    to_save.last_update = new Date().toLocaleDateString();
    await dynamoDB.put({
        TableName: "Files",
        Item: {
            ...to_save
        }
    }).promise();

    return {
        statusCode: 200,
        headers: headers,
        body: JSON.stringify(to_save)
    };
};

export const deleteFile = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    // Some important routine
    if (!event.requestContext.authorizer) return {
        headers: headers, statusCode: 403,
        body: "You need to authorize via Cognito! To debud via API Gateway - add 'Authorization' header. To debug via lambda - add requestContext.authorizer.claims manually"
    };
    const sub = event.requestContext.authorizer.claims['sub'];
    const email = event.requestContext.authorizer.claims['email'];
    if (!event.body) return { headers: headers, statusCode: 400, body: "No request body!" };
    let new_file: UniversalFile = JSON.parse(event.body);

    // Get meta from DynamoDB
    let responce = await dynamoDB.get({
        TableName: "Files",
        Key: {
            file_id: new_file.file_id
        }
    }).promise();
    let file = responce.Item as UniversalFile;
    if (!file) return { statusCode: 404, body: "File not found!" };

    // Security
    if (file.user_sub != sub) return { headers: headers, statusCode: 403, body: "File must be your's!" };

    if (file.s3_url) {
        await s3.deleteObject({ Bucket: BUCKET, Key: file.s3_url.replace(`https://${BUCKET}.s3.amazonaws.com/`, '')}).promise();
    }

    await dynamoDB.delete({
        TableName : 'Files',
        Key: {
            file_id: new_file.file_id
        }
    }).promise()

    return {
        statusCode: 200,
        headers: headers,
        body: JSON.stringify(file)
    };
};
