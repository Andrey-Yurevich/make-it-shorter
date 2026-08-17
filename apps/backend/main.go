package main

import (
	"context"
	"log"
	"net/http"
	"os"

	// The timezone database is not present on provided.al2023. Without this import
	// time.LoadLocation fails, and a swallowed failure would quietly mean UTC — that is,
	// the wrong day boundary for every quota counter. Loading it is fatal at start.
	_ "time/tzdata"

	"github.com/aws/aws-lambda-go/lambdaurl"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime"
	bedrocktypes "github.com/aws/aws-sdk-go-v2/service/bedrockruntime/types"
	"github.com/aws/aws-sdk-go-v2/service/cloudwatch"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
)

// Everything below is resolved once at start and read-only afterwards. The prompt and
// the tool definition especially: they have to stay byte-identical between requests or
// the prompt cache is lost.
var (
	cfg *config
	cat *buttonCatalog

	staticPrompt   string
	toolDefinition bedrocktypes.Tool

	bedrockClient    *bedrockruntime.Client
	dynamoClient     *dynamodb.Client
	cloudwatchClient *cloudwatch.Client
)

func main() {
	log.SetFlags(0)

	var err error
	if cfg, err = loadConfig(); err != nil {
		log.Fatalf("configuration: %v", err)
	}

	// catalog.json is packaged next to the binary by make-release.sh and read from the
	// working directory, /var/task under Lambda.
	catalogPath := os.Getenv("CATALOG_PATH")
	if catalogPath == "" {
		catalogPath = "catalog.json"
	}
	if cat, err = loadCatalog(catalogPath); err != nil {
		log.Fatalf("catalog: %v", err)
	}

	staticPrompt = buildStaticPrompt(cat)
	if len(cat.activeIDs) > 0 {
		toolDefinition = buildToolDefinition(cat)
	}

	awsConfig, err := awsconfig.LoadDefaultConfig(context.Background())
	if err != nil {
		log.Fatalf("aws configuration: %v", err)
	}
	bedrockClient = bedrockruntime.NewFromConfig(awsConfig)
	dynamoClient = dynamodb.NewFromConfig(awsConfig)
	cloudwatchClient = cloudwatch.NewFromConfig(awsConfig)

	// LOCAL_ADDR runs the same handler as an ordinary HTTP server, for development
	// against the real Bedrock and DynamoDB. Lambda never sets it.
	if address := os.Getenv("LOCAL_ADDR"); address != "" {
		log.Printf("listening on %s", address)
		log.Fatal(http.ListenAndServe(address, http.HandlerFunc(route)))
	}

	lambdaurl.Start(http.HandlerFunc(route))
}

// Routing by path inside the function. There is one endpoint today; the switch costs
// nothing and gives the second one somewhere to go.
func route(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost && r.URL.Path == "/v1/summarize" {
		handleSummarize(w, r)
		return
	}
	// An unknown path is a plain 404, not SSE: there is no error code for it, because
	// no client of ours can produce one.
	http.NotFound(w, r)
}
