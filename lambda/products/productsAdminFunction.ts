import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from "aws-lambda";
import { Product, ProductRepository } from "/opt/nodejs/productsLayer";
import { DynamoDB, Lambda } from "aws-sdk";
import { ProductEvent, ProductEventType } from "lambda/products/layers/productEventsLayer/nodej/productEvent";
import * as AWSXRay from "aws-xray-sdk";

// tudo que fizer nas minhas funções lambdas utilizando o sdk vai ser monitorado com isso.
AWSXRay.captureAWS(require("aws-sdk"))

const productsDdb = process.env.PRODUCTS_DDB!
const productEventsFunctionName = process.env.PRODUCT_EVENTS_FUNCTION_NAME!

const ddbClient = new DynamoDB.DocumentClient()
const lambdaClient = new Lambda()

const productRepository = new ProductRepository(ddbClient, productsDdb)


export async function handler(event: APIGatewayProxyEvent, 
  context: Context): Promise<APIGatewayProxyResult> {
    
    const lambdaRequestId = context.awsRequestId;
    const apiRequestId = event.requestContext.requestId;

    // log no cloudWatch
    console.log(`API Gateway RequestId: ${apiRequestId} - || - Lambda RequestId: ${lambdaRequestId}`)

    if (event.resource === "/products") {
      console.log(`POST/products`)

      const product = JSON.parse(event.body!) as Product
      const productCreated = await productRepository.create(product)

      const response = await sendProductEvent(productCreated, ProductEventType.CREATED, "djalma@test.com.br", lambdaRequestId)
      console.log(response)

      return {
        statusCode: 201,
        body: JSON.stringify(productCreated)
      }

    } else if (event.resource === "/products/{id}") {
      const productId = event.pathParameters!.id as string
      
        if (event.httpMethod === "PUT") {
          console.log(`PUT/products/${productId}`)

          const product = JSON.parse(event.body!) as Product

          try {
            const productUpdated = await productRepository.updateProduct(productId, product)

            const response = await sendProductEvent(productUpdated, ProductEventType.UPDATED	, "galdino@test.com.br", lambdaRequestId)
            console.log(response)

            return {
              statusCode: 200,
              body: JSON.stringify(productUpdated)
            }

          } catch (ConditionalCheckFailedException) {
            return {
              statusCode: 404,
              body: "Product not found"
            }
          }

         

        } else if (event.httpMethod === "DELETE") {
          console.log(`DELETE/products/${productId}`)

          try {
            const product = await productRepository.deleteProduct(productId)

            const response = await sendProductEvent(product, ProductEventType.DELETED	, "jubileu@test.com.br", lambdaRequestId)
            console.log(response)

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
      }
      
      return {
        statusCode: 400,
        body: "Bad request"
      }
    }

    function sendProductEvent(product: Product, eventType: ProductEventType, email: string, lambdaRequestId: string) {

      const event: ProductEvent = {
        email: email,
        eventType: eventType,
        productCode: product.code,
        productId: product.id,
        productPrice: product.price,
        requestId: lambdaRequestId

      }

      return lambdaClient.invoke({
        FunctionName: productEventsFunctionName,
        Payload: JSON.stringify(event),
        InvocationType: "Event"
      }).promise()

    }
