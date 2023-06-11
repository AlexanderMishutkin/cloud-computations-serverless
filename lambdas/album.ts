import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { DynamoDB, S3 } from "aws-sdk";
import * as uuid from 'uuid';
import { Album, UniversalFile } from "./common/entities";
import { changeAlbum, generateSafeS3Name, getAlbum, getDefaultAlbum } from "./common/utils";

const BUCKET = 'tim18-cloud-computing-user-upload';
const s3 = new S3();
const dynamoDB = new DynamoDB.DocumentClient();
const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'OPTIONS,GET,PUT,POST,DELETE',
}


export const postAlbum = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    // Some important routine
    if (!event.body) return { headers: headers, statusCode: 400, body: "No request body!" };
    let album: Album = JSON.parse(event.body);
    if (!album.name) return { headers: headers, statusCode: 400, body: "Album name is required!" };
    if (!event.requestContext.authorizer) return {
        headers: headers, statusCode: 403,
        body: "You need to authorize via Cognito! To debud via API Gateway - add 'Authorization' header. To debug via lambda - add requestContext.authorizer.claims manually"
    };
    const sub = event.requestContext.authorizer.claims['sub'];
    const email = event.requestContext.authorizer.claims['email'];
    
    album.album_id = uuid.v1();
    album.user_sub = sub;
    album.files_ids = album.files_ids ?? [];
    album.shared_with_emails = album.shared_with_emails ?? [];
    album.creation_date = new Date().toLocaleDateString();
    album.last_update = album.creation_date;

    await dynamoDB.put({
        TableName: "Albums",
        Item: {
            ...album
        }
    }).promise();
    return {
        headers: headers, statusCode: 200,
        body: JSON.stringify(album)
    };
}

export const getOneAlbum = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    // Some important routine
    if (!event.requestContext.authorizer) return {
        headers: headers, statusCode: 403,
        body: "You need to authorize via Cognito! To debud via API Gateway - add 'Authorization' header. To debug via lambda - add requestContext.authorizer.claims manually"
    };
    const sub = event.requestContext.authorizer.claims['sub'];
    const email = event.requestContext.authorizer.claims['email'];
    const { album_id } = event.pathParameters as { album_id: string };

    let result = await getAlbum(album_id, email, sub, dynamoDB);
    if (result.error || !result.album) return {headers: headers, ...result.error};

    
    // Get USER'S meta from DynamoDB
    let files: UniversalFile[] = []; 
    for (let file_id of (result.album.files_ids ?? [])) {
        let responce = await dynamoDB.get({
            TableName: "Files",
            Key: {
                file_id: file_id
            }
        }).promise();
        files.push(responce.Item as UniversalFile);
    }

    return {
        headers: headers, statusCode: 200,
        body: JSON.stringify({...result.album, files: files})
    };
}

export const getAllAlbums = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    // Some important routine
    if (!event.requestContext.authorizer) return {
        headers: headers, statusCode: 403,
        body: "You need to authorize via Cognito! To debud via API Gateway - add 'Authorization' header. To debug via lambda - add requestContext.authorizer.claims manually"
    };
    const sub = event.requestContext.authorizer.claims['sub'];
    const email = event.requestContext.authorizer.claims['email'];

    const params = {
        TableName: 'Albums',
        FilterExpression: 'user_sub = :sub',
        ExpressionAttributeValues: {
          ':sub': sub
        }
    };
    let responce = await dynamoDB.scan(params).promise();
    let my_albums = responce.Items as Album[];
    
    // Get SHARED meta from DynamoDB
    const params1 = {
        TableName: 'Albums',
        FilterExpression: 'contains(shared_with_emails, :email)',
        ExpressionAttributeValues: {
          ':email': email
        }
    };
    responce = await dynamoDB.scan(params1).promise();
    let shared_albums: Album[] = [];
    shared_albums.push(...responce.Items as Album[]);

    return {
        statusCode: 200, headers: headers,
        body: JSON.stringify({
            my_albums: my_albums,
            shared_albums: shared_albums
        })
    };
}

export const editAlbum = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    // Some important routine
    if (!event.body) return { headers: headers, statusCode: 400, body: "No request body!" };
    let album: Album = JSON.parse(event.body);
    if (!album.name) return { headers: headers, statusCode: 400, body: "Album name is required!" };
    if (!event.requestContext.authorizer) return {
        headers: headers, statusCode: 403,
        body: "You need to authorize via Cognito! To debud via API Gateway - add 'Authorization' header. To debug via lambda - add requestContext.authorizer.claims manually"
    };
    const sub = event.requestContext.authorizer.claims['sub'];
    const email = event.requestContext.authorizer.claims['email'];
    
    let result = await changeAlbum(album, sub, dynamoDB);
    if (result.error || !result.album) return {headers: headers, ...result.error};
    return {
        headers: headers, statusCode: 200,
        body: JSON.stringify(album)
    };
}

export const deleteAlbum = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    // Some important routine
    if (!event.requestContext.authorizer) return {
        headers: headers, statusCode: 403,
        body: "You need to authorize via Cognito! To debud via API Gateway - add 'Authorization' header. To debug via lambda - add requestContext.authorizer.claims manually"
    };
    const sub = event.requestContext.authorizer.claims['sub'];
    const email = event.requestContext.authorizer.claims['email'];
    if (!event.body) return { headers: headers, statusCode: 400, body: "No request body!" };
    let album_id = (JSON.parse(event.body) as Album).album_id;

    let result = await getAlbum(album_id, email, sub, dynamoDB);
    if (result.error || !result.album) return {headers: headers, ...result.error};
    if (result.album.user_sub != sub) return { headers: headers, statusCode: 403, body: "Album must be your's!" };

    await dynamoDB.delete({
        TableName : 'Albums',
        Key: {
        album_id: result.album.album_id
        }
    }).promise()
    
    for (let file_id of (result.album.files_ids ?? [])) {
        let responce = await dynamoDB.get({
            TableName: "Files",
            Key: {
                file_id: file_id
            }
        }).promise();
        let file = responce.Item as UniversalFile;

        if (file.s3_url) {
            await s3.deleteObject({ Bucket: BUCKET, Key: file.s3_url.replace(`https://${BUCKET}.s3.amazonaws.com/`, '')}).promise();
        }
    
        if (file) await dynamoDB.delete({
            TableName : 'Files',
            Key: {
                file_id: file.file_id
            }
        }).promise()
    }

    return {
        statusCode: 200,
        headers: headers,
        body: JSON.stringify(result.album)
    };
}
