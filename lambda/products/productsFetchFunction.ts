import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from "aws-lambda";
import { ProductRepository } from "/opt/nodejs/productsLayer";
import { DynamoDB } from "aws-sdk";
import * as AWSXRay from "aws-xray-sdk";

// tudo que fizer nas minhas funções lambdas utilizando o sdk vai ser monitorado com isso.
AWSXRay.captureAWS(require("aws-sdk"))

const productsDdb = process.env.PRODUCTS_DDB!
const ddbClient = new DynamoDB.DocumentClient()

const productRepository = new ProductRepository(ddbClient, productsDdb)

export async function handler(event: APIGatewayProxyEvent, 
  context: Context): Promise<APIGatewayProxyResult> {
    
    const lambdaRequestId = context.awsRequestId;
    const apiRequestId = event.requestContext.requestId;

    // log no cloudWatch
    console.log(`API Gateway RequestId: ${apiRequestId} - || - Lambda RequestId: ${lambdaRequestId}`)

    const method = event.httpMethod
    if(event.resource === "/products") {
      if( method === 'GET') {
        console.log('GET /products')

        const products = await productRepository.getAllProducts()

        return {
          statusCode: 200,
          body: JSON.stringify(products)
        }
      }
    } else if (event.resource === "/products/{id}") {
      const productsId = event.pathParameters!.id as string

      console.log(`GET /products/${productsId}`)

      try {
        const product = await productRepository.getProductById(productsId)
        return {
          statusCode: 200,
          body: JSON.stringify(product)
        }
      } catch (error) {
        console.error((<Error>error).message)

        return {
          statusCode: 404,
          body: (<Error>error).message
        }
      }      
    }

    return {
      statusCode: 400,
      body: JSON.stringify({
        message: "Bad Request"
      })
    }
  }