# How to deploy?

`npm i`

`tsc`

`sls deploy`

# How to get user attribute in lambda?

Use `event.requestContext.authorizer.claims`. Only properly authorized users (logged via Congnito) do have claims, if you test Lambda or API Gateway you will not have any claims.

# How to add lambda?

Just add one more element to the `function` attribute in the `serverless.yml`

