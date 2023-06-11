import { APIGatewayProxyEvent, APIGatewayProxyResult, Handler } from 'aws-lambda';
import { Album, FamilyInvite } from './common/entities';
import { DynamoDB } from 'aws-sdk';


const dynamoDB = new DynamoDB.DocumentClient();
const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'OPTIONS,GET,PUT,POST,DELETE',
}

export const postSignUp: Handler = async (event, context) => {
    /*
    console.log(event.request.userAttributes);
    {
        sub: '0686cd8f-300d-4752-859b-125fd2755704',
        email_verified: 'true',
        'cognito:user_status': 'CONFIRMED',
        'cognito:email_alias': 'alex.type59@gmail.com',
        phone_number_verified: 'false',
        phone_number: '+381643566656',
        'custom:email_of_inviter': 'apmishutkin@edu.hse.ru',
        given_name: 'Aleksandr',
        family_name: 'Mishutkin',
        email: 'alex.type59@gmail.com'
    }
    */

    if (event.request.userAttributes['custom:email_of_inviter']) {
        let request: FamilyInvite = {
            invited_email: event.request.userAttributes['email'],
            inviter_email: event.request.userAttributes['custom:email_of_inviter'],
            invited_name: `${event.request.userAttributes['given_name']} ${event.request.userAttributes['family_name']}`,
            invite_status: 'NEED_CHECK'
        }

        await dynamoDB.put({
            TableName: "FamilyInvites",
            Item: {
                ...request
            }
        }).promise();
    }

    return event;
};


export const getInvites = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    // Some important routine
    if (!event.requestContext.authorizer) return {
        headers: headers, statusCode: 403,
        body: "You need to authorize via Cognito! To debud via API Gateway - add 'Authorization' header. To debug via lambda - add requestContext.authorizer.claims manually"
    };
    const sub = event.requestContext.authorizer.claims['sub'];
    const email = event.requestContext.authorizer.claims['email'];

    // Get USER'S meta from DynamoDB
    const params = {
        TableName: 'FamilyInvites',
        FilterExpression: 'inviter_email = :email AND invite_status = :invite_status',
        ExpressionAttributeValues: {
          ':email': email,
          ':invite_status': 'NEED_CHECK'
        }
    };
    let responce = await dynamoDB.scan(params).promise();
    let my_invites = responce.Items as FamilyInvite[];

    return {
        statusCode: 200, headers: headers,
        body: JSON.stringify({
            my_invites: my_invites
        })
    };
}


export const postAccept = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    if (!event.body) return { headers: headers, statusCode: 400, body: "No request body!" };
    let invite: FamilyInvite = JSON.parse(event.body);
    if (!invite.inviter_email || !invite.invited_email) return { headers: headers, statusCode: 400, body: "Client must send invite author's and invited person's emails!" };
    if (!event.requestContext.authorizer) return {
        headers: headers, statusCode: 403,
        body: "You need to authorize via Cognito! To debud via API Gateway - add 'Authorization' header. To debug via lambda - add requestContext.authorizer.claims manually"
    };
    const sub = event.requestContext.authorizer.claims['sub'];
    const email = event.requestContext.authorizer.claims['email'];

    if (invite.inviter_email != email) return { headers: headers, statusCode: 403, body: "No such invite or this invite is not yourth!" };

    let responce = await dynamoDB.get({
        TableName: "FamilyInvites",
        Key: {
            invited_email: invite.invited_email,
            inviter_email: invite.inviter_email
        }
    }).promise();
    invite = responce.Item as FamilyInvite;
    if (!invite) return { headers: headers, statusCode: 404, body: "No such invite!" };
    if (invite.invite_status != 'NEED_CHECK') return { headers: headers, statusCode: 400, body: "Invite was not waiting for check!" };

    invite.invite_status = 'SUCCESSFUL';
    await dynamoDB.put({
        TableName: "FamilyInvites",
        Item: {
            ...invite
        }
    }).promise();

    const params = {
        TableName: 'Albums',
        FilterExpression: 'user_sub = :sub',
        ExpressionAttributeValues: {
          ':sub': sub
        }
    };
    let scan_responce = await dynamoDB.scan(params).promise();
    let my_albums = scan_responce.Items as Album[];

    for (let album of my_albums) {
        if (album.shared_with_emails) {
            album.shared_with_emails.push(invite.invited_email);
        } else {
            album.shared_with_emails = [invite.invited_email];
        }
        await dynamoDB.put({
            TableName: "Albums",
            Item: {
                ...album
            }
        }).promise();
    }

    return {
        statusCode: 200,
        headers: headers,
        body: JSON.stringify(invite)
    };
}


export const postDecline = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    if (!event.body) return { headers: headers, statusCode: 400, body: "No request body!" };
    let invite: FamilyInvite = JSON.parse(event.body);
    if (!invite.inviter_email || !invite.invited_email) return { headers: headers, statusCode: 400, body: "Client must send invite author's and invited person's emails!" };
    if (!event.requestContext.authorizer) return {
        headers: headers, statusCode: 403,
        body: "You need to authorize via Cognito! To debud via API Gateway - add 'Authorization' header. To debug via lambda - add requestContext.authorizer.claims manually"
    };
    const sub = event.requestContext.authorizer.claims['sub'];
    const email = event.requestContext.authorizer.claims['email'];

    if (invite.inviter_email != email) return { headers: headers, statusCode: 403, body: "No such invite or this invite is not yourth!" };

    let responce = await dynamoDB.get({
        TableName: "FamilyInvites",
        Key: {
            invited_email: invite.invited_email,
            inviter_email: invite.inviter_email
        }
    }).promise();
    invite = responce.Item as FamilyInvite;
    if (!invite) return { headers: headers, statusCode: 404, body: "No such invite!" };
    if (invite.invite_status != 'NEED_CHECK') return { headers: headers, statusCode: 400, body: "Invite was not waiting for check!" };

    invite.invite_status = 'DECLINED_BY_INVITER';
    await dynamoDB.put({
        TableName: "FamilyInvites",
        Item: {
            ...invite
        }
    }).promise();
    
    return {
        statusCode: 200,
        headers: headers,
        body: JSON.stringify(invite)
    };
}
