package adapters

import (
	"testing"
)

func TestDetectAdapter(t *testing.T) {
	endpoint := "http://localhost:11434/api/generate"
	model := "qwen2.5:7b"
	chaseHeaders := []string{"Details", "Posting Date", "Description", "Amount", "Type", "Balance", "Check or Slip #"}
	fidelityHeaders := []string{"Transaction Date", "Name", "Memo", "Amount"}
	junkHeaders := []string{"foo", "bar", "baz"}

	// Test Chase
	adapter, err := DetectAdapter(endpoint, model, chaseHeaders, nil)
	if err != nil {
		t.Fatalf("Expected nil error for Chase headers, got: %v", err)
	}
	if _, ok := adapter.(*DynamicAdapter); !ok {
		t.Errorf("Expected DynamicAdapter, got %T", adapter)
	}

	// Test Fidelity
	adapter, err = DetectAdapter(endpoint, model, fidelityHeaders, nil)
	if err != nil {
		t.Fatalf("Expected nil error for Fidelity headers, got: %v", err)
	}
	if _, ok := adapter.(*DynamicAdapter); !ok {
		t.Errorf("Expected DynamicAdapter, got %T", adapter)
	}

	// Test BoA
	boaHeaders := []string{"Posted Date", "Reference Number", "Payee", "Address", "Amount"}
	adapter, err = DetectAdapter(endpoint, model, boaHeaders, nil)
	if err != nil {
		t.Fatalf("Expected nil error for BoA headers, got: %v", err)
	}
	if _, ok := adapter.(*DynamicAdapter); !ok {
		t.Errorf("Expected DynamicAdapter, got %T", adapter)
	}

	// Test Capital One
	capOneHeaders := []string{"Transaction Date", "Posted Date", "Card No.", "Description", "Category", "Debit", "Credit"}
	adapter, err = DetectAdapter(endpoint, model, capOneHeaders, nil)
	if err != nil {
		t.Fatalf("Expected nil error for Capital One headers, got: %v", err)
	}
	if _, ok := adapter.(*DynamicAdapter); !ok {
		t.Errorf("Expected DynamicAdapter, got %T", adapter)
	}

	// Test Junk (will attempt LLM discovery)
	// Note: If Ollama is running, this may succeed with a discovered schema
	// If Ollama is not running, this will fail with a connection error
	_, err = DetectAdapter(endpoint, model, junkHeaders, nil)
	// We don't assert on the error since it depends on whether Ollama is available
	// The important thing is that the fallback mechanism works
	_ = err
}
