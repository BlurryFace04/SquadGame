import { Schema, model, models } from 'mongoose'

const TxSchema = new Schema({
  address: {
    type: String,
    required: [true, 'Address is required'],
    immutable: true,
  },
  game: {
    type: Number,
    required: [true, 'Game is required']
  },
  amount: {
    type: Number,
    min: [0, 'amount must be a positive number']
  },
  x: {
    type: String,
    required: [true, 'X is required']
  },
  signature: {
    type: String,
    required: [true, 'Signature is required'],
    immutable: true
  },
  description: {
    type: String,
    required: [true, 'Description is required'],
    immutable: true
  },
  webhookTimestamp: {
    type: Date,
    immutable: true,
  },
  timestamp: {
    type: Date,
    default: Date.now,
    immutable: true,
  }
})

TxSchema.index({ address: 1, game: 1 }, { unique: true })

const Tx = models.Tx || model('Tx', TxSchema)

export default Tx
