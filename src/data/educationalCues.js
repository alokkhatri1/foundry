export const EDUCATIONAL_CUES = {
  // ===== CHAT TAB =====
  'chat-context-sidebar': {
    label: 'This is like RAG in production',
    title: 'Retrieval-Augmented Generation (RAG)',
    content: 'When you select knowledge files as context for the AI, you\'re doing what enterprise systems call Retrieval-Augmented Generation (RAG). The AI reads those specific documents before answering, instead of relying on its general training alone. In production, this is handled by vector databases and retrieval pipelines that automatically find the most relevant information.',
    tools: [
      { name: 'Amazon Bedrock Knowledge Bases', desc: 'Managed RAG for enterprise' },
      { name: 'Pinecone / Weaviate', desc: 'Vector databases for semantic search' },
      { name: 'LangChain', desc: 'Framework that orchestrates retrieval + generation' },
    ],
  },
  'chat-agent-conversation': {
    label: 'Like Custom GPTs or Claude Projects',
    title: 'Specialized AI Assistants',
    content: 'Chatting with a configured agent is similar to using Custom GPTs (OpenAI), Claude Projects (Anthropic), or Microsoft Copilot with specific instructions. The agent\'s behavior is shaped by its instruction file (system prompt) and knowledge files (context). In production, this is often the first entry point to agentic AI.',
    tools: [
      { name: 'OpenAI Custom GPTs', desc: 'Customizable ChatGPT assistants' },
      { name: 'Claude Projects (Anthropic)', desc: 'Project-scoped AI with custom instructions' },
      { name: 'Microsoft Copilot Studio', desc: 'Enterprise copilot builder' },
      { name: 'Google Vertex AI Agents', desc: 'Custom agents on Google Cloud' },
    ],
  },
  'chat-approval-gate': {
    label: 'Human-in-the-loop pattern',
    title: 'Human-in-the-Loop (HITL)',
    content: 'This approval gate is a Human-in-the-Loop checkpoint. In production AI systems, this is critical for high-stakes decisions \u2014 the AI advises, but a human makes the final call. This pattern ensures accountability, catches errors, and is often required for regulatory compliance in banking, healthcare, and legal.',
    tools: [
      { name: 'Salesforce Einstein', desc: 'AI recommendations with human approval' },
      { name: 'ServiceNow Virtual Agent', desc: 'ITSM workflows with human escalation' },
      { name: 'AWS Step Functions', desc: 'Wait-for-callback pattern for human tasks' },
      { name: 'Temporal.io', desc: 'Durable workflows with human-in-the-loop signals' },
    ],
  },

  // ===== FILES TAB =====
  'files-knowledge-base': {
    label: 'Your AI\'s knowledge base',
    title: 'Knowledge Management for AI',
    content: 'These documents form the knowledge base your AI agents reference. In production, this is managed through content platforms and knowledge management systems. Documents are typically chunked, embedded into vectors, and stored in specialized databases for efficient retrieval. What you do here by hand, enterprise systems automate at scale.',
    tools: [
      { name: 'Notion', desc: 'Knowledge management + AI Q&A' },
      { name: 'Confluence (Atlassian)', desc: 'Enterprise wiki with AI features' },
      { name: 'SharePoint + Copilot', desc: 'Microsoft\'s document intelligence' },
      { name: 'Google Drive + NotebookLM', desc: 'Google\'s document-grounded AI' },
    ],
  },
  'files-instructions': {
    label: 'System prompts in production',
    title: 'Prompt Engineering',
    content: 'Instruction files are what production systems call "system prompts." They define the agent\'s persona, behavior, and constraints. Getting this right is called prompt engineering \u2014 a key skill in building AI products. In production, prompts are version-controlled, A/B tested, and iterated on continuously.',
    tools: [
      { name: 'Anthropic Console (Workbench)', desc: 'Prompt iteration and testing' },
      { name: 'OpenAI Playground', desc: 'Prompt design and tuning' },
      { name: 'LangSmith / PromptLayer', desc: 'Prompt versioning and observability' },
    ],
  },

  // ===== TOOLS TAB =====
  'tools-overview': {
    label: 'Function calling in AI systems',
    title: 'Tool Use & Function Calling',
    content: 'When agents use tools, they perform what AI platforms call "function calling" or "tool use." The AI decides when to call a tool, passes structured parameters, and receives structured output. This is how agents interact with the real world \u2014 databases, APIs, calculators \u2014 rather than just generating text.',
    tools: [
      { name: 'Claude Tool Use (Anthropic)', desc: 'Native function calling in Claude' },
      { name: 'OpenAI Function Calling', desc: 'Structured tool interaction' },
      { name: 'MCP (Model Context Protocol)', desc: 'Open standard for connecting AI to tools and data' },
      { name: 'Zapier / Make.com', desc: 'No-code tool integration for AI agents' },
    ],
  },
  'tools-connect': {
    label: 'API integrations in production',
    title: 'Enterprise API Integration',
    content: 'In production, AI agents connect to real APIs \u2014 your CRM (Salesforce), ERP (SAP), communication tools (Slack, email), and databases. These connections are managed through middleware, API gateways, or integration platforms that handle auth, rate limits, and error recovery.',
    tools: [
      { name: 'MuleSoft', desc: 'Enterprise API integration' },
      { name: 'Workato', desc: 'AI-powered integration platform' },
      { name: 'n8n / Make.com', desc: 'Workflow automation with AI nodes' },
    ],
  },

  // ===== COWORKERS TAB =====
  'coworkers-overview': {
    label: 'AI coworkers across the industry',
    title: 'Building AI Coworkers',
    content: 'AI coworkers are systems that can perceive, reason, and act. Here you configure coworkers by giving them skills — each skill bundles instructions (behavior), knowledge (context), and tools (capabilities). This mirrors how agents are built across every major AI platform. The key differentiator between platforms is how they handle orchestration, memory, and tool access.',
    tools: [
      { name: 'Claude with Tool Use (Anthropic)', desc: 'Agents that reason and use tools' },
      { name: 'OpenAI Assistants API', desc: 'Stateful agents with file search and code execution' },
      { name: 'Microsoft Copilot Studio', desc: 'Enterprise agent builder' },
      { name: 'AWS Bedrock Agents', desc: 'Managed agents with enterprise integrations' },
      { name: 'Google Vertex AI Agents', desc: 'Multimodal agents on Google Cloud' },
    ],
  },
  'coworkers-skills': {
    label: 'Skills: bundling knowledge, instructions, and tools',
    title: 'Coworker Skills',
    content: 'Each skill bundles an instruction file (system prompt), knowledge files (context), and tools (capabilities). A coworker can have multiple skills — just like a real person. In workflows, you pick which specific skill a coworker should use. In direct chat, the coworker brings all their skills together.',
    tools: [
      { name: 'Claude Projects (Anthropic)', desc: 'Instructions + knowledge in one project' },
      { name: 'Custom GPTs (OpenAI)', desc: 'Skills bundled as custom GPTs' },
      { name: 'CrewAI', desc: 'Agents with roles, goals, and tools' },
    ],
  },
  'agents-overview': {
    label: 'AI agents across the industry',
    title: 'Building AI Agents',
    content: 'AI agents are systems that can perceive, reason, and act. Here you configure agents by combining instructions (behavior), knowledge (context), and tools (capabilities). This mirrors how agents are built across every major AI platform. The key differentiator between platforms is how they handle orchestration, memory, and tool access.',
    tools: [
      { name: 'Claude with Tool Use (Anthropic)', desc: 'Agents that reason and use tools' },
      { name: 'OpenAI Assistants API', desc: 'Stateful agents with file search and code execution' },
      { name: 'Microsoft Copilot Studio', desc: 'Enterprise agent builder' },
      { name: 'AWS Bedrock Agents', desc: 'Managed agents with enterprise integrations' },
      { name: 'Google Vertex AI Agents', desc: 'Multimodal agents on Google Cloud' },
    ],
  },
  'agents-knowledge': {
    label: 'Grounding agents with real data',
    title: 'AI Grounding & Context',
    content: 'Selecting knowledge files for an agent is called "grounding." It reduces hallucination by giving the AI specific facts to reference. In production, this uses vector stores, knowledge graphs, or real-time data retrieval. The more specific and well-structured your documents, the better the agent performs.',
    tools: [
      { name: 'Anthropic Contextual Retrieval', desc: 'Advanced RAG techniques' },
      { name: 'Google Vertex AI Search', desc: 'Grounding with enterprise data' },
      { name: 'Cohere RAG', desc: 'Retrieval-augmented generation platform' },
    ],
  },
  'agents-tools': {
    label: 'Giving agents capabilities',
    title: 'Agentic Tool Access',
    content: 'Assigning tools to an agent defines what it can DO beyond generating text. This is what makes an agent "agentic" \u2014 it can take actions in the world. In production, tool access is carefully scoped per agent for security. An agent that only needs to read data should not have write access.',
    tools: [
      { name: 'MCP (Model Context Protocol)', desc: 'Open standard for tool connectivity' },
      { name: 'LangChain Tools', desc: 'Composable tool integrations' },
      { name: 'CrewAI', desc: 'Multi-agent framework with shared tools' },
    ],
  },

  // ===== WORKFLOW TAB =====
  'workflow-overview': {
    label: 'Orchestration: the glue of agentic AI',
    title: 'Workflow Orchestration',
    content: 'A workflow orchestrates multiple agents, humans, and tools into a coherent process. This is the highest layer of agentic AI. In production, orchestration handles routing, retries, error handling, parallel execution, and state management. The visual flow you build here maps directly to what enterprise platforms do under the hood.',
    tools: [
      { name: 'LangGraph (LangChain)', desc: 'Graph-based agent orchestration' },
      { name: 'AWS Step Functions', desc: 'Serverless workflow orchestration' },
      { name: 'Temporal.io', desc: 'Durable workflow execution' },
      { name: 'Microsoft Power Automate + Copilot', desc: 'Low-code workflow with AI' },
    ],
  },
  'workflow-triggers': {
    label: 'How workflows start in production',
    title: 'Event-Driven Architecture',
    content: 'In production, workflows rarely start with a manual button click. They\'re triggered by events: a customer submitting a form, an email arriving, a file uploaded, an API call, or a scheduled cron job. Event-driven architecture is what scales AI from "demo" to "thousands of cases per day."',
    tools: [
      { name: 'Zapier Triggers', desc: 'Event-driven automation' },
      { name: 'AWS EventBridge', desc: 'Serverless event bus' },
      { name: 'Kafka / Pub/Sub', desc: 'Stream processing for real-time triggers' },
    ],
  },
  'workflow-approval-step': {
    label: 'Governance layer in AI',
    title: 'AI Governance & Compliance',
    content: 'Human review steps are the governance layer. In regulated industries (banking, healthcare, legal), AI decisions almost always require human oversight. The correction loop \u2014 where a reviewer sends work back to an earlier step \u2014 is a real-world pattern called "human-in-the-loop with feedback," allowing the AI to improve within a single workflow run.',
    tools: [
      { name: 'ServiceNow Approvals', desc: 'Enterprise approval workflows' },
      { name: 'Salesforce Approval Processes', desc: 'Multi-level approval chains' },
      { name: 'Guardrails AI', desc: 'Automated output validation' },
    ],
  },

  // ===== CHAT ATOMIC =====
  'chat-file-toggle': {
    label: 'Selecting context = scoping a vector search',
    title: 'Context Window Management',
    content: 'Each file toggle is like adding a document to the AI\'s "context window." In production RAG systems, this is handled by similarity search \u2014 a vector database automatically finds the most relevant chunks. Here you do it manually, which helps you understand what the AI actually sees when it answers.',
    tools: [
      { name: 'Pinecone', desc: 'Vector database for similarity search' },
      { name: 'ChromaDB', desc: 'Open-source embedding database' },
      { name: 'OpenAI Embeddings', desc: 'Text-to-vector conversion API' },
    ],
  },
  'chat-attachment': {
    label: 'Multimodal input',
    title: 'Multimodal AI',
    content: 'Attaching images, PDFs, or documents is called "multimodal input." Modern AI models can process text, images, audio, and video simultaneously. In production, document processing pipelines parse, chunk, and embed files before the AI sees them. What you upload here is parsed in real-time.',
    tools: [
      { name: 'Claude Vision (Anthropic)', desc: 'Image + document understanding' },
      { name: 'GPT-4o (OpenAI)', desc: 'Multimodal text + image + audio' },
      { name: 'Amazon Textract', desc: 'Document parsing and extraction' },
      { name: 'Unstructured.io', desc: 'Open-source document parsing' },
    ],
  },
  'chat-confidence': {
    label: 'Model calibration',
    title: 'Confidence Scores & Calibration',
    content: 'The confidence score shows how certain the AI is in its response. In production, this is used for automated routing \u2014 high-confidence answers go straight through, low-confidence ones get routed to a human. Well-calibrated scores are critical for knowing when to trust the AI.',
    tools: [
      { name: 'Guardrails AI', desc: 'Output validation and scoring' },
      { name: 'Cleanlab', desc: 'AI confidence and data quality' },
      { name: 'Arize AI', desc: 'Model performance monitoring' },
    ],
  },
  'chat-approval-actions': {
    label: 'Decision automation patterns',
    title: 'Approval Decision Types',
    content: 'These four actions map to standard enterprise decision patterns. Approve = pass through. Reject = terminate. Request Correction = feedback loop (the AI tries again). Escalate = route to a higher authority. In production, each action triggers different downstream workflows and notifications.',
    tools: [
      { name: 'ServiceNow', desc: 'Multi-tier approval routing' },
      { name: 'Salesforce Flow', desc: 'Decision trees with escalation' },
      { name: 'Jira Workflows', desc: 'Ticket state transitions' },
    ],
  },

  // ===== FILES ATOMIC =====
  'files-upload': {
    label: 'Document ingestion pipeline',
    title: 'Document Ingestion',
    content: 'When you upload a PDF, Word doc, or spreadsheet, it gets parsed into text the AI can read. In production, this is called "document ingestion" \u2014 an entire pipeline that handles OCR, table extraction, metadata tagging, chunking, and embedding. What takes seconds here takes engineering teams weeks to build at scale.',
    tools: [
      { name: 'Amazon Textract', desc: 'OCR and document parsing' },
      { name: 'LlamaParse', desc: 'AI-native document parsing' },
      { name: 'Unstructured.io', desc: 'Open-source ingestion pipeline' },
      { name: 'Google Document AI', desc: 'Enterprise document processing' },
    ],
  },

  // ===== TOOL TYPE ATOMIC =====
  'tool-type-calculate': {
    label: 'Deterministic computation',
    title: 'Calculation Tools',
    content: 'Calculate tools give AI agents access to deterministic math \u2014 scoring, ratios, cost estimates. This is critical because LLMs are unreliable at arithmetic. In production, you never let the AI do math in its head; you give it a calculator tool and let it decide when to use it.',
    tools: [
      { name: 'Wolfram Alpha API', desc: 'Computational intelligence' },
      { name: 'LangChain Calculator', desc: 'Built-in math tool for agents' },
      { name: 'Zapier Code Step', desc: 'Custom computation in workflows' },
    ],
  },
  'tool-type-lookup': {
    label: 'Search & retrieval',
    title: 'Search Tools',
    content: 'Look Up tools let agents search for information at runtime rather than relying on what\'s in their context. In production, this connects to databases, search engines, or knowledge bases. The agent formulates a query, the tool executes it, and the results flow back into the conversation.',
    tools: [
      { name: 'Elasticsearch / OpenSearch', desc: 'Full-text and semantic search' },
      { name: 'Tavily', desc: 'AI-optimized web search API' },
      { name: 'Google Custom Search API', desc: 'Programmable search engine' },
    ],
  },
  'tool-type-create': {
    label: 'Content generation & records',
    title: 'Creation Tools',
    content: 'Create tools let agents generate structured outputs \u2014 documents, records, reference IDs. In production, this is how AI agents write reports, create tickets, generate contracts, or log records into databases. The AI decides what to create; the tool handles the formatting and storage.',
    tools: [
      { name: 'Jasper AI', desc: 'AI content generation platform' },
      { name: 'DocuSign CLM', desc: 'Automated contract generation' },
      { name: 'Notion API', desc: 'Programmatic page/database creation' },
    ],
  },
  'tool-type-communicate': {
    label: 'Messaging & notifications',
    title: 'Communication Tools',
    content: 'Communicate tools let agents send messages, emails, or notifications. In production, AI agents routinely send Slack messages, emails, SMS, or push notifications as part of workflows. This is how agents interact with humans without blocking the workflow.',
    tools: [
      { name: 'Slack API', desc: 'Workspace messaging' },
      { name: 'SendGrid / Resend', desc: 'Transactional email' },
      { name: 'Twilio', desc: 'SMS and voice communication' },
    ],
  },
  'tool-type-validate': {
    label: 'Rule engines & guardrails',
    title: 'Validation Tools',
    content: 'Validate tools check inputs against rules \u2014 checklists, thresholds, compliance criteria. In production, validation is a critical safety layer. It catches errors the AI might miss and ensures outputs meet business rules before they reach customers or downstream systems.',
    tools: [
      { name: 'Guardrails AI', desc: 'LLM output validation framework' },
      { name: 'Great Expectations', desc: 'Data validation pipelines' },
      { name: 'AWS Rules Engine', desc: 'Business rule evaluation' },
    ],
  },
  'tool-testing': {
    label: 'Like an AI playground',
    title: 'Tool Testing & Iteration',
    content: 'Testing a tool with sample input before deploying it is standard practice. In production, tool definitions are tested, versioned, and monitored. If a tool breaks, the agent breaks. This test interface is similar to what you\'d find in API development tools.',
    tools: [
      { name: 'Postman', desc: 'API testing and development' },
      { name: 'Anthropic Workbench', desc: 'Prompt and tool testing' },
      { name: 'LangSmith', desc: 'Tool execution tracing and debugging' },
    ],
  },

  // ===== AGENT ATOMIC =====
  'agent-instructions': {
    label: 'The system prompt',
    title: 'System Prompt / Instruction Tuning',
    content: 'This dropdown assigns the agent\'s "system prompt" \u2014 the instructions it follows on every interaction. In production, system prompts are the most iterated-on part of an AI application. They define persona, constraints, output format, and guardrails. Small changes here dramatically change agent behavior.',
    tools: [
      { name: 'Anthropic System Prompts', desc: 'Claude\'s instruction layer' },
      { name: 'OpenAI System Messages', desc: 'GPT behavior configuration' },
      { name: 'Prompt Engineering Guide', desc: 'Best practices for prompt design' },
    ],
  },

  // ===== WORKFLOW ATOMIC: TRIGGERS =====
  'trigger-manual': {
    label: 'Web portal / intake form',
    title: 'Manual Triggers',
    content: 'A manual trigger means a human initiates the workflow \u2014 submitting a form, clicking a button, or uploading documents. In production, this is your customer portal, internal dashboard, or intake system. It\'s the simplest trigger type but still the most common for complex decisions.',
    tools: [
      { name: 'Retool / Appsmith', desc: 'Internal tool builders' },
      { name: 'Typeform', desc: 'Form-based intake' },
      { name: 'ServiceNow Portal', desc: 'Enterprise service request portals' },
    ],
  },
  'trigger-folder': {
    label: 'File event triggers',
    title: 'File-Based Triggers',
    content: 'In production, workflows start automatically when files appear \u2014 a contract uploaded to S3, a report added to SharePoint, an invoice dropped in Google Drive. Cloud storage platforms emit events that trigger downstream processing pipelines.',
    tools: [
      { name: 'AWS S3 Event Notifications', desc: 'File upload triggers' },
      { name: 'Google Drive API', desc: 'File change webhooks' },
      { name: 'Zapier / Make.com', desc: 'No-code file triggers' },
    ],
  },
  'trigger-api': {
    label: 'System-to-system integration',
    title: 'API & Webhook Triggers',
    content: 'API triggers let other systems start your workflow programmatically \u2014 a CRM creates a deal, an ERP flags an order, a monitoring system detects an anomaly. Webhooks are the "push" version: the external system calls your endpoint when something happens.',
    tools: [
      { name: 'REST / GraphQL APIs', desc: 'Standard integration protocols' },
      { name: 'Stripe Webhooks', desc: 'Payment event triggers' },
      { name: 'AWS API Gateway', desc: 'Managed API endpoints' },
    ],
  },
  'trigger-email': {
    label: 'Email-to-workflow',
    title: 'Email Triggers',
    content: 'Email triggers convert incoming messages into structured workflow inputs. In production, AI parses the email body, extracts entities (names, amounts, dates), classifies intent, and routes to the right workflow. This is how support tickets, loan applications, and RFPs are automated.',
    tools: [
      { name: 'Gmail API / Microsoft Graph', desc: 'Email inbox monitoring' },
      { name: 'Nylas', desc: 'Unified email API' },
      { name: 'Front', desc: 'Shared inbox with automation' },
    ],
  },
  'trigger-schedule': {
    label: 'Cron jobs & batch processing',
    title: 'Scheduled Triggers',
    content: 'Scheduled triggers run workflows on a timer \u2014 daily compliance checks, weekly report generation, monthly audits. In production, this is cron jobs, scheduled tasks, or cloud schedulers. Batch processing handles thousands of cases overnight while humans sleep.',
    tools: [
      { name: 'AWS CloudWatch Events', desc: 'Scheduled cloud triggers' },
      { name: 'Google Cloud Scheduler', desc: 'Managed cron service' },
      { name: 'Temporal Schedules', desc: 'Durable scheduled workflows' },
    ],
  },
  'trigger-form': {
    label: 'Customer-facing intake',
    title: 'Form Submission Triggers',
    content: 'Form triggers start when a customer or employee fills out a structured form. In production, forms capture validated, structured data that feeds directly into the workflow \u2014 loan applications, insurance claims, onboarding questionnaires. The form IS the first step of the AI pipeline.',
    tools: [
      { name: 'Typeform / Tally', desc: 'Smart form builders' },
      { name: 'Google Forms', desc: 'Simple form collection' },
      { name: 'Salesforce Web-to-Lead', desc: 'CRM intake forms' },
    ],
  },

  // ===== WORKFLOW ATOMIC: STEPS =====
  'step-type-agent': {
    label: 'LLM task execution',
    title: 'Agent Steps',
    content: 'An agent step sends the case data to an AI agent that reads, reasons, and responds. In production, this is an LLM API call with a system prompt, context documents, and tools. The agent\'s output \u2014 analysis, score, recommendation \u2014 flows into the next step of the workflow.',
    tools: [
      { name: 'Claude API (Anthropic)', desc: 'Messages API with tool use' },
      { name: 'OpenAI Chat Completions', desc: 'GPT inference endpoint' },
      { name: 'AWS Bedrock InvokeModel', desc: 'Managed LLM inference' },
    ],
  },
  'step-type-tool': {
    label: 'Automated system action',
    title: 'Tool / System Steps',
    content: 'A tool step executes a specific action without AI reasoning \u2014 calculate a score, send a notification, create a record. In production, these are deterministic operations: API calls, database writes, file generation. They\'re the "do" part of the workflow, while agent steps are the "think" part.',
    tools: [
      { name: 'AWS Lambda', desc: 'Serverless function execution' },
      { name: 'Zapier Actions', desc: 'No-code tool execution' },
      { name: 'n8n Nodes', desc: 'Workflow automation actions' },
    ],
  },
  'workflow-correction-loop': {
    label: 'Feedback loop pattern',
    title: 'Correction Loops',
    content: 'The correction loop sends work back to a previous step when a reviewer finds issues. This is a fundamental production pattern \u2014 the AI re-processes with the reviewer\'s feedback, improving its output iteratively. The max corrections limit prevents infinite loops, a safety mechanism in all production orchestrators.',
    tools: [
      { name: 'Temporal Signals', desc: 'Workflow correction via signals' },
      { name: 'AWS Step Functions Choice', desc: 'Conditional branching and loops' },
      { name: 'RLHF (Reinforcement Learning)', desc: 'Learning from human feedback at scale' },
    ],
  },
  'workflow-step-reorder': {
    label: 'Workflow choreography',
    title: 'Step Sequencing',
    content: 'Dragging steps to reorder them changes the workflow\'s execution sequence. In production, step order matters enormously \u2014 you validate before you process, analyze before you approve, notify after you decide. Getting the sequence wrong causes errors, wasted compute, or compliance violations.',
    tools: [
      { name: 'LangGraph', desc: 'Define agent execution graphs' },
      { name: 'Apache Airflow', desc: 'DAG-based task orchestration' },
      { name: 'Prefect', desc: 'Python workflow orchestration' },
    ],
  },

  // ===== ACTIVITY ATOMIC =====
  'activity-run-status': {
    label: 'Workflow state machine',
    title: 'Run Status & State Management',
    content: 'Each run moves through states: Running, Waiting for Review, Completed, Rejected, Error. This is a state machine \u2014 a fundamental computer science pattern. In production, state management handles edge cases: what happens on timeout? On partial failure? On retry? The status you see here is the simplified view of complex state logic underneath.',
    tools: [
      { name: 'Temporal.io', desc: 'Durable workflow state management' },
      { name: 'AWS Step Functions', desc: 'Visual state machine service' },
      { name: 'XState', desc: 'JavaScript state machine library' },
    ],
  },
  'activity-nudge': {
    label: 'SLA management',
    title: 'Nudges & SLA Enforcement',
    content: 'The nudge button reminds a reviewer to act. In production, this is automated SLA (Service Level Agreement) management \u2014 if a human hasn\'t acted within a deadline, the system sends reminders, escalates to a manager, or auto-approves based on policy. Unattended approvals are the #1 bottleneck in human-in-the-loop systems.',
    tools: [
      { name: 'PagerDuty', desc: 'Escalation and on-call management' },
      { name: 'ServiceNow SLA Engine', desc: 'Automated SLA tracking' },
      { name: 'OpsGenie', desc: 'Alert routing and escalation' },
    ],
  },

  // ===== ACTIVITY TAB =====
  'activity-dashboard': {
    label: 'Observability for AI systems',
    title: 'LLM Observability',
    content: 'Monitoring AI workflow runs is called "observability." In production, this goes much deeper: token usage, latency per step, cost tracking, hallucination detection, user satisfaction scores, and drift monitoring. This dashboard is a simplified version of what production monitoring looks like.',
    tools: [
      { name: 'LangSmith (LangChain)', desc: 'LLM observability and tracing' },
      { name: 'Arize AI', desc: 'ML observability platform' },
      { name: 'Helicone', desc: 'LLM cost and performance monitoring' },
      { name: 'Anthropic Console', desc: 'Usage analytics and logging' },
    ],
  },
  'activity-audit-log': {
    label: 'Audit trails for compliance',
    title: 'Audit Trails & Compliance Logging',
    content: 'Every action in an AI system needs an audit trail. In regulated industries, you must answer: Who triggered this? What did the AI recommend? Who approved it? When? Why? This log captures that chain of accountability. In production, these logs are immutable, tamper-proof, and stored in compliance-grade systems.',
    tools: [
      { name: 'Datadog / Splunk', desc: 'Enterprise logging and SIEM' },
      { name: 'AWS CloudTrail', desc: 'Audit logging for cloud operations' },
      { name: 'Weights & Biases', desc: 'ML experiment and model tracking' },
    ],
  },
};
