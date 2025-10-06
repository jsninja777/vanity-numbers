# Vanity Numbers (Node + TypeScript, AWS)

This repo implements the senior development project:

- Vanity Lambda: generates vanity number candidates and stores top 5 per caller in DynamoDB
- Web API Lambda: returns the most recent 5 saved caller entries
- Amazon Connect contact flow.
- Unit tests (Jest) for generator logic
- Minimal React web app scaffold to display last 5 entries

## Quick start
1. Install prerequisites: Node 18+, npm, AWS CLI configured.
2. Install dependencies:
   ```
   npm install
   npm --prefix src/vanity-lambda install
   npm --prefix src/webapi-lambda install
   npm --prefix webapp install
   ```
3. Build:
   ```
   npm run build:all
   ```
4. Deploy with Serverless framework:
   ```
   npm run deploy
   ```
5. Start the web app
``` 
npm --prefix webapp run dev
```

6. Phone numeber automatically gets created and the contact flow get created and assoicated with the phone number.

## Project layout
See the repository tree for files. The `serverless.yml` defines resources including the DynamoDB table and two Lambdas.

## Notes
- `webapi-lambda` uses a scan for demo. For production add a GSI on `timestamp` or a recent-items pattern.
- Tighten IAM and Lambda invoke permissions for Amazon Connect by restricting SourceArn to your Connect instance.

- Requirement to deploy locally- 
  1. Create connect instance and add the ARN to the serverless.yml file, 
  2. update the contact flow with the lambda arn by updating the aws accountId search for {accountId} to update it. 

  3. Update the INSTANCE_ID in scripts/create-contact-flow.sh to the connect instance id. and update the {accountId} to you aws account ID
      

- Test my deployed version.
  Call Test Number: +13476522444 to test on my environment.

  To view the UI run ```npm --prefix webapp install``
  then run ```npm --prefix webapp run dev``` to view it.

