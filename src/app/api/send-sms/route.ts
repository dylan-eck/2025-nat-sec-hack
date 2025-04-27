import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    // Parse the incoming request body
    const body = await request.json();
    
    // Extract the message from the request
    const { message } = body;
    
    if (!message) {
      return NextResponse.json(
        { success: false, error: 'Message is required' },
        { status: 400 }
      );
    }
    
    // Get API key and phone from environment variables
    const textbeltKey = process.env.NEXT_PUBLIC_TEXTBELT;
    const phoneNumber = process.env.NEXT_PUBLIC_EMERGENCY_PHONE;
    
    if (!textbeltKey || !phoneNumber) {
      return NextResponse.json(
        { success: false, error: 'API key or phone number not configured' },
        { status: 500 }
      );
    }

    // Make the request to Textbelt API from the server side
    const response = await fetch('https://textbelt.com/text', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        phone: phoneNumber,
        message: message,
        key: textbeltKey,
      }),
    });

    // Parse the Textbelt response
    const result = await response.json();
    
    // Return the result to the client
    return NextResponse.json(result);
    
  } catch (error) {
    console.error('Error sending SMS:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to send SMS' },
      { status: 500 }
    );
  }
} 