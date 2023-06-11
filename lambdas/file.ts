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
    const file_format = file.name.split('.').pop();
    const filename = `files/${generateSafeS3Name(email)}/${generateSafeS3Name(file.name)}_${file.file_id}.${file_format}`;
    await s3.putObject({ Bucket: BUCKET, Key: filename, Body: Buffer.from(file.data, 'base64') }).promise();
    file.s3_url = `https://${BUCKET}.s3.amazonaws.com/${filename}`;
    file.user_sub = sub;
    file.size = Math.ceil(file.data.length * 6 / 8);
    file.data = undefined;

    let album = await getAlbum(file.album_id, email, sub, dynamoDB);
    if (album.error) return {headers: headers, ...album.error}
    // Security
    if (!album.album || album.album.user_sub != sub) return { headers: headers, statusCode: 403, body: "You can add file only to your album!" };

    // Put meta data to dynamoDB
    file.album_id = album.album.album_id;
    file.creation_date = new Date().toLocaleDateString();
    file.last_update = file.creation_date;
    await dynamoDB.put({
        TableName: "Files",
        Item: {
            ...file
        }
    }).promise();
    // And link file with album
    album.album.files_ids = album.album.files_ids ?? [];
    album.album.files_ids.push(file.file_id);
    album = await changeAlbum(album.album, sub, dynamoDB)

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
        !(file.shared_with_emails.find(email)) &&
        !(album && album.shared_with_emails.find(email))
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

    // Get new album from DynamoDB
    if (new_file.album_id && new_file.album_id != file.album_id) {
        responce = await dynamoDB.get({
            TableName: "Albums",
            Key: {
                album_id: new_file.album_id
            }
        }).promise();
        let new_album = responce.Item as Album;
        if (!new_album) return { headers: headers, statusCode: 404, body: "New album not found!" };
        // Security
        if (new_album.user_sub != sub) return { headers: headers, statusCode: 403, body: "New album must be your's!" };
    }

    // Security
    if (file.user_sub != sub) return { headers: headers, statusCode: 403, body: "File must be your's!" };
    if (new_file.user_sub && new_file.user_sub != sub) return { headers: headers, statusCode: 403, body: "Can not reassign file!" };

    // Optionally update data
    if (new_file.data && file.s3_url) {
        new_file.size = Math.ceil(new_file.data.length * 6 / 8);
        await s3.putObject({ Bucket: BUCKET, Key: file.s3_url.replace(`https://${BUCKET}.s3.amazonaws.com/`, ''), Body: Buffer.from(new_file.data, 'base64') }).promise();
        new_file.data = undefined;
        new_file.s3_url = file.s3_url;
    } else {
        if (new_file.data) {
            const file_format = file.name.split('.').pop();
            const filename = `files/${generateSafeS3Name(email)}/${generateSafeS3Name(file.name)}_${file.file_id}.${file_format}`;
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

    if (to_save.album_id != file.album_id) {
        let oldAlbum = await getAlbum(file.album_id, email, sub, dynamoDB);
        if (oldAlbum.error || !oldAlbum.album) return {headers: headers, ...oldAlbum.error};
        let newAlbum = await getAlbum(to_save.album_id, email, sub, dynamoDB);
        if (newAlbum.error || !newAlbum.album) return {headers: headers, ...newAlbum.error};

        oldAlbum.album.files_ids = oldAlbum.album.files_ids.filter(id=>id!=to_save.file_id);
        newAlbum.album.files_ids.push(to_save.file_id);
        
        await dynamoDB.put({
            TableName: "Albums",
            Item: {
            ...oldAlbum.album
            }
        }).promise();
        await dynamoDB.put({
            TableName: "Albums",
            Item: {
            ...newAlbum.album
            }
        }).promise();
    }

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
    let album = await getAlbum(file.album_id, email, sub, dynamoDB);
    if (album.error || !album.album) return {headers: headers, ...album.error}

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

    album.album.files_ids = album.album.files_ids.filter(id=>id!=file.file_id);
    album = await changeAlbum(album.album, sub, dynamoDB);
    if (album.error) return {headers: headers, ...album.error}

    return {
        statusCode: 200,
        headers: headers,
        body: JSON.stringify(file)
    };
};
