import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodeJS from "aws-cdk-lib/aws-lambda-nodejs";
import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";
import * as iam from "aws-cdk-lib/aws-iam";
import { SqsDestination } from "aws-cdk-lib/aws-lambda-destinations";


interface ProductsAppStackProps extends cdk.StackProps {
  eventsDdb: dynamodb.Table
}

export class ProductsAppStack extends cdk.Stack {
  readonly productsFetchHandler: lambdaNodeJS.NodejsFunction
  readonly productsAdminHandler: lambdaNodeJS.NodejsFunction
  readonly productsDdb: dynamodb.Table

  constructor(scope: Construct, id: string, props: ProductsAppStackProps) {
    super(scope, id, props)

    // - criação da tabela no dynamoDb
    this.productsDdb = new dynamodb.Table(this, "ProductsDdb", {
      tableName: "products",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      partitionKey: {
        name: "id",
        type: dynamodb.AttributeType.STRING
      },
      billingMode: dynamodb.BillingMode.PROVISIONED,
      readCapacity: 1,
      writeCapacity: 1
    })
    // - tabela criada!

    // - Criando o layer de produtos (products Layer)
    const productsLayerArn = ssm.StringParameter.valueForStringParameter(this, "ProductsLayerVersionArn");
    const productsLayer = lambda.LayerVersion.fromLayerVersionArn(this, "ProductsLayerVersionArn", productsLayerArn)

    // capturando o Product Event Layer
    const productEventsLayerArn = ssm.StringParameter.valueForStringParameter(this, "ProductEventsLayerVersionArn");
    const productEventsLayer = lambda.LayerVersion.fromLayerVersionArn(this, "ProductEventsLayerVersionArn", productEventsLayerArn)

    //Auth user layer
    const authUserInfoLayerArn = ssm.StringParameter.valueForStringParameter(this, "AuthUserInfoLayerVersionArn")
    const authUserInfoLayer = lambda.LayerVersion.fromLayerVersionArn(this, "AuthUserInfoLayerVersionArn", authUserInfoLayerArn)

    // função lambda 1: função para evento de produtos
    const dlq = new sqs.Queue(this, "ProductEventsDlq", {
      queueName: "product-events-dlq",
      retentionPeriod: cdk.Duration.days(10)
    })
    const productEventsHandler = new lambdaNodeJS.NodejsFunction(this, "ProductsEventsFunction", {
      functionName: "ProductsEventsFunction",
      entry: "lambda/products/productEventsFunction.ts",
      handler: "handler",
      memorySize: 128,
      timeout: cdk.Duration.seconds(2),
      bundling: {
        minify: true,
        sourceMap: false
      },
      environment: {
        EVENTS_DDB: props.eventsDdb.tableName
      },
      layers: [productEventsLayer],
      tracing: lambda.Tracing.ACTIVE, // habilitando o rastreamento
      deadLetterQueueEnabled: true,
      deadLetterQueue: dlq,
      insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_119_0
    })
    // props.eventsDdb.grantWriteData(productEventsHandler)

    const eventsDdbPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["dynamodb:PutItem"],
      resources: [props.eventsDdb.tableArn],
      conditions: {
        ['ForAllValues:StringLike']: {
          'dynamodb:LeadingKeys': ['#product_*']
        }
      }
    })
    productEventsHandler.addToRolePolicy(eventsDdbPolicy)

    // função lambda 2: Funçã de produto
    this.productsFetchHandler = new lambdaNodeJS.NodejsFunction(this, "ProductsFetchFunction", {
      functionName: "ProductsFetchFunction",
      entry: "lambda/products/productsFetchFunction.ts",
      handler: "handler",
      memorySize: 128,
      timeout: cdk.Duration.seconds(5),
      bundling: {
        minify: true,
        sourceMap: false
      },
      environment: {
        PRODUCTS_DDB: this.productsDdb.tableName
      },
      layers: [productsLayer],
      tracing: lambda.Tracing.ACTIVE, // habilitando o rastreamento
      insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_119_0
    })
    // - dando a permissão de leitura da função productFetchHandler para ler a tabela productDdb
    this.productsDdb.grantReadData(this.productsFetchHandler)

    // função lambda 3: Funçao de administração
    this.productsAdminHandler = new lambdaNodeJS.NodejsFunction(this, "ProductsAdminFunction", {
      functionName: "ProductsAdminFunction",
      entry: "lambda/products/productsAdminFunction.ts",
      handler: "handler",
      memorySize: 128,
      timeout: cdk.Duration.seconds(5),
      bundling: {
        minify: true,
        sourceMap: false
      },
      environment: {
        PRODUCTS_DDB: this.productsDdb.tableName,
        PRODUCT_EVENTS_FUNCTION_NAME: productEventsHandler.functionName
      },
      layers: [productsLayer, productEventsLayer, authUserInfoLayer],
      tracing: lambda.Tracing.ACTIVE,
      // habilitando logs insight:
      insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_119_0
    })

    // - dando permissão para a função productAdminHandler escrever na tabela
    this.productsDdb.grantWriteData(this.productsAdminHandler)
    productEventsHandler.grantInvoke(this.productsAdminHandler)
  }
}