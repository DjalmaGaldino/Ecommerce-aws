// - criando o apiGateway para integra-lo a minha função lambda.

import * as lambdaNodeJS from "aws-cdk-lib/aws-lambda-nodejs";
import * as cdk from "aws-cdk-lib";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as cwlogs from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";
import { ApiGatewayManagementApi } from "aws-sdk";


interface EcommerceApiStackProps extends cdk.StackProps {
  productsFetchHandler: lambdaNodeJS.NodejsFunction
  productsAdminHandler: lambdaNodeJS.NodejsFunction
  ordersHandler: lambdaNodeJS.NodejsFunction
  orderEventsFetchHandler: lambdaNodeJS.NodejsFunction
}

export class EcommerceApiStack extends cdk.Stack {

  constructor(scope: Construct, id: string, props: EcommerceApiStackProps) {
    super(scope, id, props)

    // gerando logs do api gatwey no cloudWatch
    const logGroup = new cwlogs.LogGroup(this, "ECommerceApiLogs")

    const api = new apigateway.RestApi(this, "ECommerceApi", {
      restApiName: "ECommerceApi",
      cloudWatchRole: true,
      deployOptions: {
        accessLogDestination: new apigateway.LogGroupLogDestination(logGroup),
        accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields({
          httpMethod: true,
          ip: true,
          protocol: true,
          requestTime: true,
          resourcePath: true,
          responseLength: true,
          status: true,
          caller: true,
          user: true
        })
      }
    })

    // --- gerado logs.

    // criando um lambda integration
    this.createProductsService(props, api);
    this.createOrdersService(props, api)
  }

  private createOrdersService(props: EcommerceApiStackProps, api: apigateway.RestApi) {
    const ordersIntegration = new apigateway.LambdaIntegration(props.ordersHandler)

    // resource - /orders (recurso orders)
    const ordersResource = api.root.addResource('orders')

    //GET /orders
    //GET /orders?email=fulano@cicrano.com.br
    //GET /orders?email=fulano@cicrano.com.br&orderId=123
    ordersResource.addMethod("GET", ordersIntegration)
    
    const orderDeletionValidator = new apigateway.RequestValidator(this, "OrderDeletionValidator", {
      restApi: api,
      requestValidatorName: "OrderDeletionValidator",
      validateRequestParameters: true,
    })
    //DELETE /orders?email=fulano@cicrano.com.br&orderId=123
    ordersResource.addMethod("DELETE", ordersIntegration, {
      requestParameters: {
        'method.request.querystring.email': true,
        'method.request.querystring.orderId': true
      },
      requestValidator: orderDeletionValidator
    })

    //POST /orders
    const orderRequestValidator = new apigateway.RequestValidator(this, "OrderRequestValidator", {
      restApi: api,
      requestValidatorName: "Order request validator",
      validateRequestBody: true
    })

    // model para validar o body da requisição
    const orderModel = new apigateway.Model(this, "OrderModel", {
      modelName: "OrderModel",
      restApi: api,
      schema: {
        type: apigateway.JsonSchemaType.OBJECT,
        properties: {
          email: {
            type: apigateway.JsonSchemaType.STRING
          },
          productIds: {
            type: apigateway.JsonSchemaType.ARRAY,
            minItems: 1,
            items: {
              type: apigateway.JsonSchemaType.STRING
            }
          },
          payment: {
            type: apigateway.JsonSchemaType.STRING,
            enum: ["CASH", "DEBIT_CARD", "CREDIT_CARD"]
          }
        },
        required: [
          "email",
          "productIds",
          "payment"
        ]
      }
    })
    ordersResource.addMethod("POST", ordersIntegration, {
      requestValidator: orderRequestValidator,
      requestModels: {
        "application/json": orderModel
      }
    })

    // /orders/events
    const orderEventsResource = ordersResource.addResource("events")

    const orderEventsFetchValidator = new apigateway.RequestValidator(this, "OrderEventsFetchValidator", {
      restApi: api,
      requestValidatorName: "OrderEventsFetchValidator",
      validateRequestParameters: true
    })

    const orderEventsFunctionIntegration = new apigateway.LambdaIntegration(props.orderEventsFetchHandler)
    // GET /orders/events?email=djalma@test.com.br
    // GET /orders/events?email=djalma@test.com.br&eventType=ORDER_CREATED
    orderEventsResource.addMethod('GET', orderEventsFunctionIntegration, {
      requestParameters: {
        'method.request.querystring.email': true,
        'method.request.querystring.eventType': false,
      },
      requestValidator: orderEventsFetchValidator
    })


  }

  private createProductsService(props: EcommerceApiStackProps, api: apigateway.RestApi) {
    const productsFetchIntegration = new apigateway.LambdaIntegration(props.productsFetchHandler);

    // criando o recurso -> "/products"
    const productsResource = api.root.addResource("products");
    // adicionando o metodo http que quero: get
    productsResource.addMethod("GET", productsFetchIntegration);

    // - GET /products/{id}
    const productIdResource = productsResource.addResource("{id}");
    productIdResource.addMethod("GET", productsFetchIntegration);

    const productsAdminIntegration = new apigateway.LambdaIntegration(props.productsAdminHandler);

    const productRequestValidator = new apigateway.RequestValidator(this, "ProductRequestValidator", {
      restApi: api,
      requestValidatorName: "Product request validator",
      validateRequestBody: true
    })

    const productModel = new apigateway.Model(this, "ProductModel", {
      modelName: "ProductModel",
      restApi: api,
      contentType: "application/json",
      schema: {
        type: apigateway.JsonSchemaType.OBJECT,
        properties: {
          productName: {
            type: apigateway.JsonSchemaType.STRING
          },
          code: {
            type: apigateway.JsonSchemaType.STRING
          },
          model: {
            type: apigateway.JsonSchemaType.STRING,
          },
          productUrl: {
            type: apigateway.JsonSchemaType.STRING,
          },
          price: {
            type: apigateway.JsonSchemaType.NUMBER,
          }
        },
        required: [
          "productIds",
          "code"
        ]
      }
    })
    // POST /products
    productsResource.addMethod("POST", productsAdminIntegration, {
      requestValidator: productRequestValidator,
      requestModels: {
        "application/json": productModel
      }
    });

    // PUT /products/{id}
    productIdResource.addMethod("PUT", productsAdminIntegration, {
      requestValidator: productRequestValidator,
      requestModels: {
        "application/json": productModel
      }
    });

    // DELETE /products/{id}
    productIdResource.addMethod("DELETE", productsAdminIntegration);
  }
}