import * as cdk from "aws-cdk-lib"
import * as apigatewayv2 from "@aws-cdk/aws-apigatewayv2-alpha"
import * as apigatewayv2_integrations from "@aws-cdk/aws-apigatewayv2-integrations-alpha"
import * as lambdaNodeJS from "aws-cdk-lib/aws-lambda-nodejs"
import * as dynamodb from "aws-cdk-lib/aws-dynamodb"
import * as lambda from "aws-cdk-lib/aws-lambda"
import * as s3 from "aws-cdk-lib/aws-s3"
import * as iam from "aws-cdk-lib/aws-iam"
import * as s3n from "aws-cdk-lib/aws-s3-notifications"
import * as ssm from "aws-cdk-lib/aws-ssm"
import { Construct } from "constructs"

export class InvoiceWSApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    //Invoice Transaction Layer
    const invoiceTransactionLayerArn = ssm.StringParameter.valueForStringParameter(this, "InvoiceTransactionLayerVersionArn");
    const invoiceTransactionLayer = lambda.LayerVersion.fromLayerVersionArn(this, "InvoiceTransactionLayer", invoiceTransactionLayerArn)

    //Invoice Layer
    const invoiceLayerArn = ssm.StringParameter.valueForStringParameter(this, "InvoiceRepositoryLayerVersionArn");
    const invoiceLayer = lambda.LayerVersion.fromLayerVersionArn(this, "InvoiceRepositoryLayer", invoiceLayerArn)

    // Invoice Websocket API Layer
    const invoiceWSConnectionLayerArn = ssm.StringParameter.valueForStringParameter(this, "InvoiceWSConnectionLayerVersionArn");
    const invoiceWSConnectionLayer = lambda.LayerVersion.fromLayerVersionArn(this, "InvoiceWSConnectionLayer", invoiceWSConnectionLayerArn)

    // Invoice and invoice transaction DDB (CRIANDO A TABELA)
    const invoicesDdb = new dynamodb.Table(this, "InvoicesDdb", {
      tableName: 'invoices',
      billingMode: dynamodb.BillingMode.PROVISIONED,
      readCapacity: 1,
      writeCapacity: 1,
      partitionKey: {
        name: "pk",
        type: dynamodb.AttributeType.STRING
      },
      sortKey: {
        name: "sk",
        type: dynamodb.AttributeType.STRING
      },
      timeToLiveAttribute: "ttl",
      removalPolicy: cdk.RemovalPolicy.DESTROY
    })

    // Invoice bucket
    const bucket = new s3.Bucket(this, "InvoiceBucket", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [
        {
          enabled: true,
          expiration: cdk.Duration.days(1)
        }
      ]
    })

    //webSocket connetion handler
    const connetionHandler = new lambdaNodeJS.NodejsFunction(this, "InvoiceConnectionFunction", {
      functionName: "InvoiceConnectionFunction",
      entry: "lambda/invoices/invoiceConnectionFunction.ts",
      handler: "handler",
      memorySize: 128,
      timeout: cdk.Duration.seconds(2),
      bundling: {
        minify: true,
        sourceMap: false
      },
      tracing: lambda.Tracing.ACTIVE, // habilitando o rastreamento
    })

    //webSocket disconnetion handler
    const disconnetionHandler = new lambdaNodeJS.NodejsFunction(this, "InvoiceDisconnectionFunction", {
      functionName: "InvoiceDisconnectionFunction",
      entry: "lambda/invoices/invoiceDisconnectionFunction.ts",
      handler: "handler",
      memorySize: 128,
      timeout: cdk.Duration.seconds(2),
      bundling: {
        minify: true,
        sourceMap: false
      },
      tracing: lambda.Tracing.ACTIVE, // habilitando o rastreamento
    })

    //webSocket Api
    const webSocketApi = new apigatewayv2.WebSocketApi(this, "InvoiceWSApi", {
      apiName: "InvoiceWSApi",
      connectRouteOptions: {
        integration: new apigatewayv2_integrations.WebSocketLambdaIntegration("ConnectionHandler", connetionHandler)
      },
      disconnectRouteOptions: {
        integration: new apigatewayv2_integrations.WebSocketLambdaIntegration("DisconnectionHandler", disconnetionHandler)
      }
    })

    const stage = "prod"
    const wsApiEndpoint = `${webSocketApi.apiEndpoint}/${stage}`
    new apigatewayv2.WebSocketStage(this, "InvoiceWSApiStage", {
      webSocketApi: webSocketApi,
      stageName: stage,
      autoDeploy: true
    })

    //Invoce URL handler
    const getUrlHandler = new lambdaNodeJS.NodejsFunction(this, "InvoiceGetUrlFunction", {
      functionName: "InvoiceGetUrlFunction",
      entry: "lambda/invoices/invoiceGetUrlFunction.ts",
      handler: "handler",
      memorySize: 128,
      timeout: cdk.Duration.seconds(2),
      bundling: {
        minify: true,
        sourceMap: false
      },
      layers: [invoiceTransactionLayer, invoiceWSConnectionLayer],
      tracing: lambda.Tracing.ACTIVE, // habilitando o rastreamento
      environment: {
        INVOICE_DDB: invoicesDdb.tableName,
        BUCKET_NAME: bucket.bucketName,
        INVOICE_WSAPI_ENDPOINT: wsApiEndpoint
      }
    })
    const invoiceDdbWriteTransactionPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:PutItem'],
      resources: [invoicesDdb.tableArn],
      conditions: {
        ['ForAllValues:StringLike']: {
          'dynamodb:LeadingKeys': ['#transaction']
        }
      }
    })
    const invoiceBucketPutObjectPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['s3:PutObject'],
      resources: [`${bucket.bucketArn}/*`]
    })
    getUrlHandler.addToRolePolicy(invoiceDdbWriteTransactionPolicy)
    getUrlHandler.addToRolePolicy(invoiceBucketPutObjectPolicy)
    webSocketApi.grantManageConnections(getUrlHandler)

    //Invoce import handler
    const invoiceImportHandler = new lambdaNodeJS.NodejsFunction(this, "InvoiceImportFunction", {
      functionName: "InvoiceImportFunction",
      entry: "lambda/invoices/invoiceImportFunction.ts",
      handler: "handler",
      memorySize: 128,
      timeout: cdk.Duration.seconds(2),
      bundling: {
        minify: true,
        sourceMap: false
      },
      layers: [invoiceLayer, invoiceTransactionLayer, invoiceWSConnectionLayer],
      tracing: lambda.Tracing.ACTIVE, // habilitando o rastreamento
      environment: {
        INVOICE_DDB: invoicesDdb.tableName,
        INVOICE_WSAPI_ENDPOINT: wsApiEndpoint
      }
    })
    invoicesDdb.grantReadWriteData(invoiceImportHandler)

    bucket.addEventNotification(s3.EventType.OBJECT_CREATED_PUT, new s3n.LambdaDestination(invoiceImportHandler))

    const invoicesBucketGetDeleteObjectPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions:['s3:DeleteObject', 's3:GetObject'],
      resources: [`${bucket.bucketArn}/*`]
    })
    invoiceImportHandler.addToRolePolicy(invoicesBucketGetDeleteObjectPolicy)
    webSocketApi.grantManageConnections(invoiceImportHandler)

    //Cancel import handler
    const cancelImportHandler = new lambdaNodeJS.NodejsFunction(this, "CancelImportFunction", {
      functionName: "CancelImportFunction",
      entry: "lambda/invoices/cancelImportFunction.ts",
      handler: "handler",
      memorySize: 128,
      timeout: cdk.Duration.seconds(2),
      bundling: {
        minify: true,
        sourceMap: false
      },
      layers: [invoiceTransactionLayer, invoiceWSConnectionLayer],
      tracing: lambda.Tracing.ACTIVE, // habilitando o rastreamento
      environment: {
        INVOICE_DDB: invoicesDdb.tableName,
        INVOICE_WSAPI_ENDPOINT: wsApiEndpoint
      }
    })

    const invoiceDdbReadWriteTransactionPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:UpdateItem', 'dynamodb:GetItem'],
      resources: [invoicesDdb.tableArn],
      conditions: {
        ['ForAllValues:StringLike']: {
          'dynamodb:LeadingKeys': ['#transaction']
        }
      }
    })
    cancelImportHandler.addToRolePolicy(invoiceDdbReadWriteTransactionPolicy)
    webSocketApi.grantManageConnections(cancelImportHandler)

    //websocket API routes (configurando uma rota no ws api)
    webSocketApi.addRoute('getImportUrl', {
      integration: new apigatewayv2_integrations.WebSocketLambdaIntegration("GetUrlHandler", getUrlHandler)
    })

    webSocketApi.addRoute('cancelImport', {
    integration: new apigatewayv2_integrations.WebSocketLambdaIntegration("CancelImportHandler", cancelImportHandler)
    })

  }
}