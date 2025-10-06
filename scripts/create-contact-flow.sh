#!/usr/bin/env bash
set -euo pipefail

INSTANCE_ID="68679478-72be-41b4-8093-a375768d2783"
LAMBDA_ARN="arn:aws:lambda:us-east-1:{accountId}:function:vanity-numbers-project-development-vanityLambda"
REGION="us-east-1"
FLOW_NAME="Vanity Numbers Flow"
FLOW_DESCRIPTION="Vanity Number Flow with Lambda invocation"

# Use the properly formatted contact flow from the JSON file
CONTACT_FLOW_DEFINITION=$(cat contact_flow/vanity_numbers_flow.json)

echo "🔍 Checking if contact flow '$FLOW_NAME' already exists..."
existing_flow=$(aws connect list-contact-flows \
  --instance-id "$INSTANCE_ID" \
  --region "$REGION" \
  --query "ContactFlowSummaryList[?Name=='$FLOW_NAME']" \
  --output json)

if [ "$existing_flow" != "[]" ] && [ "$existing_flow" != "null" ] && [ -n "$existing_flow" ]; then
  echo "✅ Contact flow '$FLOW_NAME' already exists!"
  CONTACT_FLOW_ID=$(echo "$existing_flow" | grep -o '"Id": "[^"]*"' | sed 's/"Id": "\([^"]*\)"/\1/')
  CONTACT_FLOW_ARN=$(echo "$existing_flow" | grep -o '"Arn": "[^"]*"' | sed 's/"Arn": "\([^"]*\)"/\1/')
  echo "📞 Using existing Contact Flow ID: $CONTACT_FLOW_ID"
  echo "📞 Contact Flow ARN: $CONTACT_FLOW_ARN"
else
  echo "📝 Contact flow '$FLOW_NAME' not found. Creating new one..."
  resp=$(aws connect create-contact-flow \
    --instance-id "$INSTANCE_ID" \
    --region "$REGION" \
    --name "$FLOW_NAME" \
    --type "CONTACT_FLOW" \
    --description "$FLOW_DESCRIPTION" \
    --content "$CONTACT_FLOW_DEFINITION" \
    --status PUBLISHED 2>&1) || {
    echo "❌ Contact flow creation failed. AWS response:"
    echo "$resp"
    exit 1
  }

  echo "✅ Contact flow created successfully!"
  echo "$resp"

  # Extract the Contact Flow ID from the response using grep and sed (no jq required)
  CONTACT_FLOW_ID=$(echo "$resp" | grep -o '"ContactFlowId": "[^"]*"' | sed 's/"ContactFlowId": "\([^"]*\)"/\1/')
  if [ -z "$CONTACT_FLOW_ID" ]; then
    echo "❌ Could not extract Contact Flow ID from response"
    echo "Response was: $resp"
    exit 1
  fi

  echo "📞 New Contact Flow ID: $CONTACT_FLOW_ID"
fi

# Get the first available phone number
echo "🔍 Getting phone number from Connect instance..."
PHONE_NUMBER_INFO=$(aws connect list-phone-numbers \
  --instance-id "$INSTANCE_ID" \
  --region "$REGION" \
  --query 'PhoneNumberSummaryList[0]' \
  --output json)

if [ "$PHONE_NUMBER_INFO" = "null" ] || [ -z "$PHONE_NUMBER_INFO" ]; then
  echo "❌ No phone numbers found in Connect instance"
  echo "Please claim a phone number in Amazon Connect console first"
  exit 1
fi

# Extract phone number ID and phone number 
PHONE_NUMBER_ID=$(echo "$PHONE_NUMBER_INFO" | grep -o '"Id": "[^"]*"' | sed 's/"Id": "\([^"]*\)"/\1/')
PHONE_NUMBER=$(echo "$PHONE_NUMBER_INFO" | grep -o '"PhoneNumber": "[^"]*"' | sed 's/"PhoneNumber": "\([^"]*\)"/\1/')

if [ -z "$PHONE_NUMBER_ID" ] || [ -z "$PHONE_NUMBER" ]; then
  echo "❌ Could not extract phone number information"
  echo "Response was: $PHONE_NUMBER_INFO"
  exit 1
fi

echo "📱 Found phone number: $PHONE_NUMBER"
echo "📱 Phone Number ID: $PHONE_NUMBER_ID"

# Assign the contact flow to the phone number with retry logic
echo "🔗 Assigning contact flow to phone number..."
echo "⏳ Waiting a moment for contact flow to be available..."

# Wait a few seconds for the contact flow to be fully available
sleep 5

# Try to assign the contact flow with retry logic
MAX_RETRIES=3
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
  echo "🔄 Attempt $((RETRY_COUNT + 1)) of $MAX_RETRIES..."
  
  assign_resp=$(aws connect associate-phone-number-contact-flow \
    --instance-id "$INSTANCE_ID" \
    --phone-number-id "$PHONE_NUMBER_ID" \
    --contact-flow-id "$CONTACT_FLOW_ID" \
    --region "$REGION" 2>&1)
  
  if [ $? -eq 0 ]; then
    echo "✅ Contact flow assigned successfully!"
    break
  else
    RETRY_COUNT=$((RETRY_COUNT + 1))
    if [ $RETRY_COUNT -lt $MAX_RETRIES ]; then
      echo "⚠️ Assignment failed, retrying in 10 seconds..."
      echo "Error: $assign_resp"
      sleep 10
    else
      echo "❌ Failed to assign contact flow after $MAX_RETRIES attempts."
      echo "AWS response: $assign_resp"
      echo ""
      echo "📝 Manual assignment needed:"
      echo "   Go to Amazon Connect console → Phone numbers → Assign contact flow: $CONTACT_FLOW_ID"
      echo "   Or try running this command manually:"
      echo "   aws connect associate-phone-number-contact-flow --instance-id $INSTANCE_ID --phone-number-id $PHONE_NUMBER_ID --contact-flow-id $CONTACT_FLOW_ID --region $REGION"
      exit 1
    fi
  fi
done

echo "✅ Contact flow assigned to phone number successfully!"
echo "🎉 Setup complete! You can now call $PHONE_NUMBER to test your vanity numbers!"

echo ""
echo "📋 Summary:"
echo "- Contact Flow ID: $CONTACT_FLOW_ID"
echo "- Phone Number ID: $PHONE_NUMBER_ID"
echo "- Phone Number: $PHONE_NUMBER"
echo "- Lambda ARN: $LAMBDA_ARN"
echo "- Test Number: $PHONE_NUMBER"
