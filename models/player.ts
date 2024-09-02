import { Schema, model, models } from 'mongoose'

const PlayerSchema = new Schema({
  address: {
    type: String,
    required: [true, 'Address is required']
  },
  x: {
    type: String,
    required: [true, 'X is required']
  },
  game: {
    type: Number
  },
  round: {
    type: Number
  },
  timestamp: {
    type: Date,
    default: Date.now,
    immutable: true
  }
})

const Player = models.Player || model('Player', PlayerSchema)

export default Player
