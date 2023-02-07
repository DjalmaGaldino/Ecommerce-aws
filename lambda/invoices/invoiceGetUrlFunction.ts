import { ApiGatewayManagementApi, DynamoDB, S3 } from "aws-sdk";
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from "aws-lambda";
import * as AWSXRay from "aws-xray-sdk"
import { v4 as uuid } from "uuid"

AWSXRay.captureAWS(require("aws-sdk"))

const invoiceDdb = process.env.INVOICE_DDB!
const bucketName = process.env.BUCKET_NAME!
const invoicesWSApiEndpoint = process.env.INVOICE_WSAPI_ENDPOINT!.substring(6)

const s3Client = new S3()
const ddbClient = new DynamoDB.DocumentClient()
const apigatewayManagementApi = new ApiGatewayManagementApi({
  endpoint: invoicesWSApiEndpoint
})

export async function handler(event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> {

  // to be removed
  console.log(event)

  const lambdaRequestId = context.awsRequestId
  const connectionId = event.requestContext.connectionId!

  console.log(`ConnectionId: ${connectionId} - Lambda RequestId: ${lambdaRequestId}`)

  const key = uuid()
  const expires = 300

  const signedUrlPut = await s3Client.getSignedUrlPromise('putObject', {
    Bucket: bucketName,
    Key: key,
    Expires: expires
  })

  return {
    statusCode: 200,
    body: 'OK'
  }

}