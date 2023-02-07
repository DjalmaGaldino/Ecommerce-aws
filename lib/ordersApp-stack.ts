// - essa stack é do serviço de pedido. Aqui ficará os recursos do serviço de pedidos
// - aqui, a primaryKey é um atributo composto por partitionKey e sortkey

import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as lambdaNodeJS from "aws-cdk-lib/aws-lambda-nodejs"
import * as cdk from "aws-cdk-lib"
import * as sub from "aws-cdk-lib/aws-sns-subscriptions"
import * as sns from "aws-cdk-lib/aws-sns"
import * as sqs from "aws-cdk-lib/aws-sqs"
import * as lambdaEventSource from "aws-cdk-lib/aws-lambda-event-sources"
import * as dynamodb from "aws-cdk-lib/aws-dynamodb"
import * as ssm from "aws-cdk-lib/aws-ssm"
import * as subs from "aws-cdk-lib/aws-sns-subscriptions"
import * as iam from "aws-cdk-lib/aws-iam"
import { Construct } from "constructs"


interface OrdersAppStackProps extends cdk.StackProps {
  productsDdb: dynamodb.Table,
  eventsDdb: dynamodb.Table,
}

export class OrdersAppStack extends cdk.Stack {
  readonly ordersHandler: lambdaNodeJS.NodejsFunction
  readonly orderEventsFetchHandler: lambdaNodeJS.NodejsFunction

  constructor(scope: Construct, id: string, props: OrdersAppStackProps) {
    super(scope, id, props)

    const ordersDdb = new dynamodb.Table(this, "OrdersDdb", {
      tableName: "orders",
      partitionKey: {
        name: "pk",
        type: dynamodb.AttributeType.STRING
      },
      sortKey: {
        name: "sk",
        type: dynamodb.AttributeType.STRING
      },
      billingMode: dynamodb.BillingMode.PROVISIONED,
      readCapacity: 1,
      writeCapacity: 1
    })

    // layer de pedidos (orders Layer)
    const ordersLayerArn = ssm.StringParameter.valueForStringParameter(this, "OrdersLayerVersionArn");
    const ordersLayer = lambda.LayerVersion.fromLayerVersionArn(this, "OrdersLayerVersionArn", ordersLayerArn)

    // order event larer
    const orderEventsLayerArn = ssm.StringParameter.valueForStringParameter(this, "OrderEventsLayerVersionArn");
    const orderEventsLayer = lambda.LayerVersion.fromLayerVersionArn(this, "OrderEventsLayerVersionArn", orderEventsLayerArn)
    
    // order Events Repository Layer
    const orderEventsRepositoryLayerArn = ssm.StringParameter.valueForStringParameter(this, "OrderEventsRepositoryLayerVersionArn");
    const orderEventsRepositoryLayer = lambda.LayerVersion.fromLayerVersionArn(this, "OrderEventsRepositoryLayerVersionArn", orderEventsRepositoryLayerArn)

    // layer  (orders Api Layer)
    const ordersApiLayerArn = ssm.StringParameter.valueForStringParameter(this, "OrdersApiLayerVersionArn");
    const ordersApiLayer = lambda.LayerVersion.fromLayerVersionArn(this, "OrdersApiLayerVersionArn", ordersApiLayerArn)

    // layer de produtos (products Layer)
    const productsLayerArn = ssm.StringParameter.valueForStringParameter(this, "ProductsLayerVersionArn");
    const productsLayer = lambda.LayerVersion.fromLayerVersionArn(this, "ProductsLayerVersionArn", productsLayerArn)

    // topico de sns
    const ordersTopic = new sns.Topic(this, "OrderEventsTopic", {
      displayName: "Order events topic",
      topicName: "order-events"
    })

    this.ordersHandler = new lambdaNodeJS.NodejsFunction(this, "OrdersFunction", {
      functionName: "OrdersFunction",
      entry: "lambda/orders/ordersFunction.ts",
      handler: "handler",
      memorySize: 128,
      timeout: cdk.Duration.seconds(2),
      bundling: {
        minify: true,
        sourceMap: false
      },
      environment: {
        PRODUCTS_DDB: props.productsDdb.tableName,
        ORDERS_DDB: ordersDdb.tableName,
        ORDER_EVENTS_TOPIC_ARN: ordersTopic.topicArn
      },
      layers: [ordersLayer, productsLayer, ordersApiLayer, orderEventsLayer],
      tracing: lambda.Tracing.ACTIVE, // habilitando o rastreamento
      insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_119_0
    })

    ordersDdb.grantReadWriteData(this.ordersHandler)
    props.productsDdb.grantReadData(this.ordersHandler)
    ordersTopic.grantPublish(this.ordersHandler)  // permissão para publicar as mensagens

    const orderEventsHandler = new lambdaNodeJS.NodejsFunction(this, "OrderEventsFunction", {
      functionName: "OrderEventsFunction",
      entry: "lambda/orders/orderEventsFunction.ts",
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
      layers: [ orderEventsLayer, orderEventsRepositoryLayer ],
      tracing: lambda.Tracing.ACTIVE, // habilitando o rastreamento
      insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_119_0
    })

    ordersTopic.addSubscription(new subs.LambdaSubscription(orderEventsHandler))

    const eventsDdbPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["dynamodb:PutItem"],
      resources: [props.eventsDdb.tableArn],
      conditions: {
        ['ForAllValues:StringLike']: {
          'dynamodb:LeadingKeys': ['#order_*']
        }
      }
    })
    orderEventsHandler.addToRolePolicy(eventsDdbPolicy)

    const billingHandler = new lambdaNodeJS.NodejsFunction(this, "BillingFunction", {
      functionName: "BillingFunction",
      entry: "lambda/orders/billingFunction.ts",
      handler: "handler",
      memorySize: 128,
      timeout: cdk.Duration.seconds(2),
      bundling: {
        minify: true,
        sourceMap: false
      },
      tracing: lambda.Tracing.ACTIVE, // habilitando o rastreamento
      insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_119_0
    })
    ordersTopic.addSubscription(new subs.LambdaSubscription(billingHandler, {
      filterPolicy: {
        eventType: sns.SubscriptionFilter.stringFilter({
          allowlist: ['ORDER_CREATED']
        })
      }
    }))

    // criando a fila
    const orderEventsDlq = new sqs.Queue(this, "OrderEventsDlq", {
      queueName: "order-events-dlq",
      retentionPeriod: cdk.Duration.days(10)
    })
    
    const orderEventsQueue = new sqs.Queue(this, "OrderEventsQueue", {
      queueName: "order-events",
      deadLetterQueue: {
        maxReceiveCount: 3,
        queue: orderEventsDlq
      }
    })
    ordersTopic.addSubscription(new subs.SqsSubscription(orderEventsQueue, {
        filterPolicy: {
          eventType: sns.SubscriptionFilter.stringFilter({
            allowlist: ['ORDER_CREATED']
          })
        }
    }))

    // funçao para enviar email
    const orderEmailsHandler = new lambdaNodeJS.NodejsFunction(this, "OrderEmailsFunction", {
      functionName: "OrderEmailsFunction",
      entry: "lambda/orders/orderEmailsFunction.ts",
      handler: "handler",
      memorySize: 128,
      timeout: cdk.Duration.seconds(2),
      bundling: {
        minify: true,
        sourceMap: false
      },
      layers: [orderEventsLayer],
      tracing: lambda.Tracing.ACTIVE, // habilitando o rastreamento
      insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_119_0
    })
    orderEmailsHandler.addEventSource(new lambdaEventSource.SqsEventSource(orderEventsQueue, {
      batchSize: 5,
      enabled: true,
      maxBatchingWindow: cdk.Duration.minutes(1)
    }))
    orderEventsQueue.grantConsumeMessages(orderEmailsHandler)
    
    const orderEmailSesPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["ses:SendEmail", "ses:SendRawEmail"],
      resources: ["*"]
    })
    orderEmailsHandler.addToRolePolicy(orderEmailSesPolicy)


    this.orderEventsFetchHandler = new lambdaNodeJS.NodejsFunction(this, "OrderEventsFetchHandler", {
      functionName: "OrderEventsFetchHandler",
      entry: "lambda/orders/orderEventsFetchHandler.ts",
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
      layers: [orderEventsRepositoryLayer],
      tracing: lambda.Tracing.ACTIVE, // habilitando o rastreamento
      insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_119_0
    })
    const eventsFetchDdbPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:Query'],
      resources: [`${props.eventsDdb.tableArn}/index/emailIndex`]
    })
    this.orderEventsFetchHandler.addToRolePolicy(eventsFetchDdbPolicy)
  }
}