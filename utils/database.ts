import mongoose from 'mongoose';

let isConnected = false;

export const connectToDB = async () => {
  mongoose.set('strictQuery', false);

  if (isConnected) {
    console.log('MongoDB is already connected');
    return;
  }

  try {
    await mongoose.connect(process.env.MONGODB_URI as string, {
      dbName: 'SquadGames',
    });

    isConnected = true;

    console.log('MongoDB Connected');
  } catch (error) {
    console.log(error);
  }
};
