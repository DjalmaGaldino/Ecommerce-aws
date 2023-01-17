// código de fato do meu layer

import { DocumentClient } from "aws-sdk/clients/dynamodb";
import { v4 as uuid } from "uuid"

export interface Product {
  id: string;
  productName: string;
  code: string;
  price: number;
  model: string,
  productUrl: string;
}

// - criando o repositorio

export class ProductRepository {
  private ddbClient: DocumentClient
  private productsDdb: string

  constructor(ddbClient: DocumentClient, productsDdb: string) {
    this.ddbClient = ddbClient
    this.productsDdb = productsDdb
  }

  // criando as operações que se conectam com o banco ---
  async getAllProducts(): Promise<Product[]> {
    const data = await this.ddbClient.scan({
      TableName: this.productsDdb
    }).promise()

    return data.Items as Product[]
  }

  async getProductById(productId: string): Promise<Product> {
    const data = await this.ddbClient.get({
      TableName: this.productsDdb,
      Key: {
        id: productId
      }
    }).promise()

    if(data.Item) {
      return data.Item as Product
    } else {
      throw new Error('Product not found')
    }
  }

  async getProductsByIds(productIds: string[]): Promise<Product[]> {
    const keys: { id: string; }[] = []
    productIds.forEach(productId => {
      keys.push({
        id: productId
      })
    })

    // dados em batch: pegando todos de uma unica vez
    const data = await this.ddbClient.batchGet({
      RequestItems: {
        [this.productsDdb]: {
          Keys: keys
        }
      }
    }).promise()
    return data.Responses![this.productsDdb] as Product[]
  }

  // persistindo um produto na tabela
  async create(product: Product): Promise<Product> {
    product.id = uuid()
    await this.ddbClient.put({
      TableName: this.productsDdb,
      Item: product
    }).promise()

    return product
  }

  // apagando um produto pelo id
  async deleteProduct(productId: string): Promise<Product> {
    const data = await this.ddbClient.delete({
      TableName: this.productsDdb,
      Key: {
        id: productId
      },
      ReturnValues: "ALL_OLD"
    }).promise()

    if (data.Attributes) {
      return data.Attributes as Product
    } else {
      throw new Error('Product not found')
    }
  }

  // - alterando um produto pelo id
  async updateProduct(productId: string, product: Product): Promise<Product> {
    const data = await this.ddbClient.update({
      TableName: this.productsDdb,
      Key: {
        id: productId
      },
      ConditionExpression: 'attribute_exists(id)',
      ReturnValues: "UPDATED_NEW",
      UpdateExpression: "set productName = :n, code = :c, price = :p, model = :m, productUrl = :u",
      ExpressionAttributeValues: {
        ":n": product.productName,
        ":c": product.code,
        ":p": product.price,
        ":m": product.model,
        ":u": product.productUrl
      }
    }).promise()
    data.Attributes!.id = productId
    return data.Attributes as Product
  } 
}