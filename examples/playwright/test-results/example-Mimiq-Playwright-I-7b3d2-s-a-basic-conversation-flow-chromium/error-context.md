# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: example.spec.ts >> Mimiq Playwright Integration >> runs a basic conversation flow
- Location: tests/example.spec.ts:11:3

# Error details

```
Test timeout of 30000ms exceeded.
```

# Page snapshot

```yaml
- generic [ref=e3]:
  - generic [ref=e4]:
    - heading "TechShop Support" [level=1] [ref=e5]
    - paragraph [ref=e6]: How can we help you today?
  - generic [ref=e7]:
    - button "Track Order" [ref=e8] [cursor=pointer]
    - button "Start Return" [ref=e9] [cursor=pointer]
  - generic [ref=e10]:
    - generic [ref=e11]:
      - generic [ref=e12]: You
      - generic [ref=e13]: Hello, I need help with my order
    - generic [ref=e14]:
      - generic [ref=e15]: Support Agent
      - generic [ref=e16]: I can help with that! Do you have an order number, or can I look up your order using your email address?
    - generic [ref=e17]:
      - generic [ref=e18]: You
      - generic [ref=e19]: "Yes, my order number is #12345."
    - generic [ref=e20]:
      - generic [ref=e21]: Support Agent
      - generic [ref=e22]: "I apologize, but I couldn't find an order with the ID #12345. Could you please double-check the order number?"
    - generic [ref=e23]:
      - generic [ref=e24]: You
      - generic [ref=e25]: "I just double-checked, and it’s definitely #12345. Would there be another way to look it up?"
    - generic [ref=e26]:
      - generic [ref=e27]: Support Agent
      - generic [ref=e28]: I'm sorry that the order number isn't working. Yes, I can try to look it up using your email address. Could you please provide it?
    - generic [ref=e29]:
      - generic [ref=e30]: You
      - generic [ref=e31]: Sure, my email address is user@example.com.
    - generic [ref=e32]:
      - generic [ref=e33]: Support Agent
      - generic [ref=e34]: I couldn't find any orders associated with the email user@example.com either. Are you sure you're using the correct email address, or perhaps it was a different one used for the order?
    - generic [ref=e35]:
      - generic [ref=e36]: You
      - generic [ref=e37]: Yes, I'm sure it's the correct email. Is there another way to check the order status?
    - generic [ref=e38]:
      - generic [ref=e39]: Support Agent
      - generic [ref=e40]: "I'm really sorry, but I've tried looking up your order using both the order number #12345 and your email address user@example.com, and I haven't been able to find any matching orders in our system. At this point, I've exhausted the methods I have to look up orders. Would you like me to escalate this to a human agent who might have access to more tools or information to help you find your order?"
  - generic [ref=e41]:
    - textbox "Type your message..." [ref=e42]
    - button "Send" [ref=e43] [cursor=pointer]
  - generic [ref=e44]: Agent is ready
```